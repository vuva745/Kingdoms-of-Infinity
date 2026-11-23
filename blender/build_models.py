"""
Procedurally builds the game models in Blender and exports them as GLB.

Run headless:
    blender --background --python build_models.py -- <output-dir> [model ...]

Conventions: Blender is Z-up, +Y forward. The glTF exporter converts to Y-up, so
+Y forward here becomes -Z forward in three.js, which is what the games expect.
"""
import math
import sys
from pathlib import Path

import bpy
import bmesh

OUT = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else Path("models")
ONLY = set(sys.argv[sys.argv.index("--") + 2:]) if "--" in sys.argv else set()
OUT.mkdir(parents=True, exist_ok=True)

# ----------------------------------------------------------------------------- helpers
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def srgb(hex_color, alpha=1.0):
    """Hex colour -> linear RGBA tuple (Blender works in linear space)."""
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), alpha)


_materials = {}


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0, coat=0.0, alpha=1.0):
    if name in _materials:
        return _materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(color, alpha)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    if emission:
        bsdf.inputs["Emission Color"].default_value = srgb(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        mat.blend_method = "BLEND"
        bsdf.inputs["Alpha"].default_value = alpha
    _materials[name] = mat
    return mat


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_scale(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def smooth(obj, angle=35):
    activate(obj)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass


def bevel(obj, width=0.05, segments=3, angle=30):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = True
    return mod


def subsurf(obj, levels=1):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    return mod


def finish(obj, name, mat, bevel_width=None, segments=3, smooth_angle=35, sub=0):
    obj.name = name
    apply_scale(obj)
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if bevel_width:
        bevel(obj, bevel_width, segments)
    if sub:
        subsurf(obj, sub)
    smooth(obj, smooth_angle)
    return obj


def cube(name, size, loc, mat, bevel_width=0.04, segments=3, rot=(0, 0, 0), sub=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.scale = size
    return finish(obj, name, mat, bevel_width, segments, sub=sub)


def cylinder(name, radius, depth, loc, mat, rot=(0, 0, 0), verts=24, bevel_width=0.02, radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=radius2, depth=depth, location=loc, rotation=rot, vertices=verts)
    obj = bpy.context.active_object
    return finish(obj, name, mat, bevel_width, 3, smooth_angle=40)


def sphere(name, radius, loc, mat, scale=(1, 1, 1), segments=24, rings=16, sub=0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=segments, ring_count=rings)
    obj = bpy.context.active_object
    obj.scale = scale
    return finish(obj, name, mat, None, smooth_angle=80, sub=sub)


def ico(name, radius, loc, mat, scale=(1, 1, 1), subdivisions=2, sub=0):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, location=loc, subdivisions=subdivisions)
    obj = bpy.context.active_object
    obj.scale = scale
    return finish(obj, name, mat, None, smooth_angle=80, sub=sub)


def cone(name, radius, depth, loc, mat, verts=16, sub=0, bevel_width=None):
    bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=0, depth=depth, location=loc, vertices=verts)
    obj = bpy.context.active_object
    return finish(obj, name, mat, bevel_width, 2, smooth_angle=45, sub=sub)


def torus(name, major, minor, loc, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot, major_segments=48, minor_segments=14)
    obj = bpy.context.active_object
    return finish(obj, name, mat, None, smooth_angle=80)


def boolean_cut(obj, cutters):
    for cutter in cutters:
        mod = obj.modifiers.new("Cut", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        mod.solver = "EXACT"
        activate(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for cutter in cutters:
        bpy.data.objects.remove(cutter, do_unlink=True)


def root(name):
    bpy.ops.object.empty_add(location=(0, 0, 0))
    empty = bpy.context.active_object
    empty.name = name
    return empty


def parent(children, root_obj):
    for child in children:
        child.parent = root_obj
        child.matrix_parent_inverse = root_obj.matrix_world.inverted()


def face_forward(objs):
    """Rotate parts modelled with -Y as the front so that +Y (glTF -Z) is forward."""
    for obj in objs:
        activate(obj)
        obj.rotation_euler.z += math.pi
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def export(root_obj, filename):
    bpy.ops.object.select_all(action="DESELECT")
    root_obj.select_set(True)
    for child in root_obj.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root_obj
    path = str(OUT / f"{filename}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_lights=False,
        export_cameras=False,
        export_animations=False,
        export_skins=False,
        export_extras=False,
    )
    tris = sum(len(p.vertices) - 2 for o in root_obj.children_recursive if o.type == "MESH" for p in o.data.polygons)
    print(f"[models] wrote {path} ({tris} tris)")
    clear_scene()


def wheel(name, loc, radius=0.38, width=0.36, tyre=None, rim=None):
    tyre = tyre or material("Tyre", "#141619", 0.0, 0.95)
    rim = rim or material("Rim", "#c8d0dc", 0.95, 0.25)
    tyre_obj = cylinder(f"{name}_tyre", radius, width, loc, tyre, rot=(0, math.pi / 2, 0), verts=28, bevel_width=0.05)
    rim_obj = cylinder(f"{name}_rim", radius * 0.62, width + 0.03, loc, rim, rot=(0, math.pi / 2, 0), verts=20, bevel_width=0.02)
    hub = cylinder(f"{name}_hub", radius * 0.2, width + 0.08, loc, material("Hub", "#2b2f36", 0.8, 0.3), rot=(0, math.pi / 2, 0), verts=12)
    activate(tyre_obj)
    rim_obj.select_set(True)
    hub.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    # bake the axle orientation into the mesh so the node can simply spin around X
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return obj


# ----------------------------------------------------------------------------- models
def build_car():
    paint = material("Paint", "#0ab8ff", 0.85, 0.22, coat=1.0)
    glass = material("Glass", "#0c1a2a", 0.9, 0.05)
    trim = material("Trim", "#15181f", 0.6, 0.5)
    head = material("Headlight", "#ffffff", 0.0, 0.2, "#ffffff", 8.0)
    tail = material("Taillight", "#ff2a3a", 0.0, 0.3, "#ff2030", 5.0)
    neon = material("Neon", "#5fd4ff", 0.0, 0.4, "#5fd4ff", 4.0)

    body = cube("Body", (1.9, 3.8, 0.56), (0, 0, 0.62), paint, bevel_width=0.14, segments=4)
    arches = []
    for x in (-1.0, 1.0):
        for y in (-1.2, 1.2):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.6, location=(x, y, 0.42), rotation=(0, math.pi / 2, 0), vertices=24)
            arches.append(bpy.context.active_object)
    boolean_cut(body, arches)
    hood = cube("Hood", (1.7, 1.3, 0.14), (0, 1.05, 0.95), paint, bevel_width=0.06)
    cabin = cube("Cabin", (1.5, 1.8, 0.5), (0, -0.15, 1.12), glass, bevel_width=0.18, segments=4)
    roof = cube("Roof", (1.35, 1.2, 0.07), (0, -0.2, 1.4), paint, bevel_width=0.03)
    splitter = cube("Splitter", (2.0, 0.35, 0.16), (0, 1.95, 0.32), trim, bevel_width=0.04)
    diffuser = cube("Diffuser", (1.9, 0.3, 0.2), (0, -1.95, 0.34), trim, bevel_width=0.04)
    skirt_l = cube("SkirtL", (0.12, 2.3, 0.14), (-0.98, 0, 0.32), trim, bevel_width=0.03)
    skirt_r = cube("SkirtR", (0.12, 2.3, 0.14), (0.98, 0, 0.32), trim, bevel_width=0.03)
    wing = cube("Wing", (1.95, 0.42, 0.06), (0, -1.75, 1.12), paint, bevel_width=0.02)
    struts = [cube(f"Strut{i}", (0.08, 0.1, 0.32), (x, -1.75, 0.95), trim, bevel_width=0.01) for i, x in enumerate((-0.75, 0.75))]
    lights = [cube(f"Head{i}", (0.46, 0.12, 0.16), (x, 1.92, 0.72), head, bevel_width=0.03) for i, x in enumerate((-0.65, 0.65))]
    lights += [cube(f"Tail{i}", (0.5, 0.08, 0.13), (x, -1.92, 0.74), tail, bevel_width=0.02) for i, x in enumerate((-0.7, 0.7))]
    lights += [cube("Strip", (1.2, 0.06, 0.05), (0, -1.93, 0.74), tail, bevel_width=0.01)]
    exhausts = [cylinder(f"Exhaust{i}", 0.09, 0.3, (x, -1.98, 0.42), neon, rot=(math.pi / 2, 0, 0), verts=12) for i, x in enumerate((-0.5, 0.5))]
    mirrors = [cube(f"Mirror{i}", (0.22, 0.12, 0.1), (x, 0.5, 1.05), paint, bevel_width=0.03) for i, x in enumerate((-1.02, 1.02))]

    parts = [body, hood, cabin, roof, splitter, diffuser, skirt_l, skirt_r, wing, *struts, *lights, *exhausts, *mirrors]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    shell = bpy.context.active_object
    shell.name = "Shell"

    wheels = [wheel(f"Wheel_{tag}", (x, y, 0.4)) for tag, x, y in (("FL", -1.0, 1.2), ("FR", 1.0, 1.2), ("RL", -1.0, -1.2), ("RR", 1.0, -1.2))]
    r = root("Car")
    parent([shell, *wheels], r)
    export(r, "car")


def build_sedan():
    paint = material("Paint", "#ff4b3e", 0.7, 0.3, coat=0.6)
    glass = material("Glass", "#0c1a2a", 0.9, 0.05)
    trim = material("Trim", "#15181f", 0.6, 0.5)
    head = material("Headlight", "#ffffff", 0.0, 0.2, "#ffffff", 6.0)
    tail = material("Taillight", "#ff2a3a", 0.0, 0.3, "#ff2030", 4.0)
    body = cube("Body", (1.9, 3.6, 0.6), (0, 0, 0.62), paint, bevel_width=0.14, segments=4)
    arches = []
    for x in (-1.0, 1.0):
        for y in (-1.15, 1.15):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.6, location=(x, y, 0.42), rotation=(0, math.pi / 2, 0), vertices=24)
            arches.append(bpy.context.active_object)
    boolean_cut(body, arches)
    cabin = cube("Cabin", (1.6, 1.9, 0.6), (0, -0.05, 1.15), glass, bevel_width=0.22, segments=4)
    roof = cube("Roof", (1.45, 1.3, 0.07), (0, -0.05, 1.47), paint, bevel_width=0.03)
    bumpers = [cube("BumperF", (1.95, 0.25, 0.22), (0, 1.82, 0.36), trim, bevel_width=0.05), cube("BumperR", (1.95, 0.25, 0.22), (0, -1.82, 0.36), trim, bevel_width=0.05)]
    lights = [cube(f"Head{i}", (0.42, 0.1, 0.15), (x, 1.82, 0.7), head, bevel_width=0.03) for i, x in enumerate((-0.65, 0.65))]
    lights += [cube(f"Tail{i}", (0.45, 0.08, 0.13), (x, -1.82, 0.72), tail, bevel_width=0.02) for i, x in enumerate((-0.7, 0.7))]
    parts = [body, cabin, roof, *bumpers, *lights]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    shell = bpy.context.active_object
    shell.name = "Shell"
    wheels = [wheel(f"Wheel{i}", (x, y, 0.4)) for i, (x, y) in enumerate(((-1.0, 1.15), (1.0, 1.15), (-1.0, -1.15), (1.0, -1.15)))]
    activate(wheels[0])
    for w in wheels[1:]:
        w.select_set(True)
    bpy.ops.object.join()
    wheels_obj = bpy.context.active_object
    wheels_obj.name = "Wheels"
    r = root("Sedan")
    parent([shell, wheels_obj], r)
    export(r, "sedan")


def build_truck():
    paint = material("Paint", "#ffb347", 0.6, 0.35)
    cargo = material("Cargo", "#d8dde8", 0.2, 0.7)
    glass = material("Glass", "#0c1a2a", 0.9, 0.05)
    trim = material("Trim", "#15181f", 0.6, 0.5)
    head = material("Headlight", "#ffffff", 0.0, 0.2, "#ffffff", 6.0)
    tail = material("Taillight", "#ff2a3a", 0.0, 0.3, "#ff2030", 4.0)
    cab = cube("Cab", (2.1, 1.7, 1.2), (0, 2.1, 0.95), paint, bevel_width=0.12, segments=4)
    windshield = cube("Windshield", (1.9, 0.9, 0.7), (0, 2.0, 1.75), glass, bevel_width=0.15, segments=3)
    cab_roof = cube("CabRoof", (1.95, 1.3, 0.1), (0, 1.9, 2.12), paint, bevel_width=0.04)
    box = cube("Box", (2.3, 4.2, 2.3), (0, -0.75, 1.45), cargo, bevel_width=0.08, segments=3)
    stripe = cube("Stripe", (2.32, 4.0, 0.3), (0, -0.75, 1.0), paint, bevel_width=0.02)
    chassis = cube("Chassis", (2.0, 5.8, 0.25), (0, 0.1, 0.3), trim, bevel_width=0.03)
    bumper = cube("Bumper", (2.2, 0.25, 0.3), (0, 3.0, 0.4), trim, bevel_width=0.05)
    lights = [cube(f"Head{i}", (0.4, 0.1, 0.18), (x, 3.0, 0.75), head, bevel_width=0.03) for i, x in enumerate((-0.75, 0.75))]
    lights += [cube(f"Tail{i}", (0.4, 0.08, 0.16), (x, -2.88, 0.7), tail, bevel_width=0.02) for i, x in enumerate((-0.85, 0.85))]
    parts = [cab, windshield, cab_roof, box, stripe, chassis, bumper, *lights]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    shell = bpy.context.active_object
    shell.name = "Shell"
    wheels = [wheel(f"Wheel{i}", (x, y, 0.42), radius=0.42, width=0.4) for i, (x, y) in enumerate(((-1.0, 2.0), (1.0, 2.0), (-1.0, -0.4), (1.0, -0.4), (-1.0, -1.9), (1.0, -1.9)))]
    activate(wheels[0])
    for w in wheels[1:]:
        w.select_set(True)
    bpy.ops.object.join()
    wheels_obj = bpy.context.active_object
    wheels_obj.name = "Wheels"
    r = root("Truck")
    parent([shell, wheels_obj], r)
    export(r, "truck")


def build_ship():
    hull = material("Hull", "#1dd68a", 0.75, 0.25, "#0b5c3a", 0.6, coat=0.8)
    dark = material("Dark", "#16324a", 0.85, 0.3)
    glass = material("Canopy", "#7dffc8", 0.6, 0.08, "#2fffb0", 1.5, alpha=0.85)
    core = material("Core", "#7dffc8", 0.0, 0.3, "#7dffc8", 6.0)
    thruster = material("Thruster", "#5fd4ff", 0.0, 0.3, "#5fd4ff", 6.0)
    body = cube("Fuselage", (1.0, 2.8, 0.42), (0, 0, 0), hull, bevel_width=0.3, segments=6)
    nose = cone("Nose", 0.45, 1.1, (0, 1.75, 0.0), hull, verts=16, bevel_width=0.08)
    nose.rotation_euler = (math.pi / 2, 0, 0)
    canopy = sphere("Canopy", 0.38, (0, 0.35, 0.22), glass, scale=(0.8, 1.4, 0.6))
    wing_l = cube("WingL", (1.5, 0.9, 0.08), (-1.1, -0.3, -0.02), dark, bevel_width=0.04, rot=(0, 0, 0.12))
    wing_r = cube("WingR", (1.5, 0.9, 0.08), (1.1, -0.3, -0.02), dark, bevel_width=0.04, rot=(0, 0, -0.12))
    fin_l = cube("FinL", (0.08, 0.6, 0.45), (-1.7, -0.5, 0.22), hull, bevel_width=0.03)
    fin_r = cube("FinR", (0.08, 0.6, 0.45), (1.7, -0.5, 0.22), hull, bevel_width=0.03)
    engines = [cylinder(f"Engine{i}", 0.2, 0.7, (x, -1.2, -0.02), dark, rot=(math.pi / 2, 0, 0), verts=16, bevel_width=0.04) for i, x in enumerate((-0.45, 0.45))]
    glows = [cylinder(f"Glow{i}", 0.14, 0.12, (x, -1.58, -0.02), thruster, rot=(math.pi / 2, 0, 0), verts=16, bevel_width=0.01) for i, x in enumerate((-0.45, 0.45))]
    gem = sphere("CoreGem", 0.16, (0, -0.45, 0.3), core)
    parts = [body, nose, canopy, wing_l, wing_r, fin_l, fin_r, *engines, *glows, gem]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    shell = bpy.context.active_object
    shell.name = "Ship"
    r = root("ShipRoot")
    parent([shell], r)
    export(r, "ship")


def build_drone():
    core = material("Core", "#ff3b4e", 0.5, 0.3, "#ff3b4e", 2.5)
    metal = material("Metal", "#222833", 0.95, 0.2)
    eye = material("Eye", "#ffffff", 0.0, 0.2, "#ffffff", 8.0)
    body = ico("Core", 0.55, (0, 0, 0), core, subdivisions=2)
    ring = torus("Ring", 0.95, 0.07, (0, 0, 0), metal)
    arms = []
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        arms.append(cube(f"Arm{i}", (0.1, 0.75, 0.06), (math.cos(a) * 0.55, math.sin(a) * 0.55, 0), metal, bevel_width=0.015, rot=(0, 0, a - math.pi / 2)))
    pods = [sphere(f"Pod{i}", 0.12, (math.cos(i * math.pi / 2 + math.pi / 4) * 0.95, math.sin(i * math.pi / 2 + math.pi / 4) * 0.95, 0), metal) for i in range(4)]
    eye_obj = sphere("Eye", 0.13, (0, 0.5, 0.08), eye)
    parts = [body, ring, *arms, *pods, eye_obj]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    shell = bpy.context.active_object
    shell.name = "Drone"
    r = root("DroneRoot")
    parent([shell], r)
    export(r, "drone")


def build_knight():
    armor = material("Armor", "#7a86ff", 0.7, 0.3, coat=0.5)
    steel = material("Steel", "#dfe7f5", 0.95, 0.22)
    skin = material("Skin", "#f1c9a5", 0.0, 0.7)
    cape_mat = material("Cape", "#b3122d", 0.0, 0.9)
    gold = material("Gold", "#e0b04a", 0.95, 0.3)
    plume = material("Plume", "#ff5577", 0.0, 0.6, "#ff5577", 0.6)
    leather = material("Leather", "#4a3221", 0.0, 0.85)
    torso = sphere("Torso", 0.45, (0, 0, 0.95), armor, scale=(1.0, 0.75, 1.25), sub=1)
    chest = cube("Chest", (0.62, 0.3, 0.5), (0, -0.18, 1.05), steel, bevel_width=0.1, segments=4)
    belt = cylinder("Belt", 0.46, 0.12, (0, 0, 0.55), leather, verts=20, bevel_width=0.02)
    buckle = cube("Buckle", (0.16, 0.08, 0.12), (0, -0.42, 0.55), gold, bevel_width=0.02)
    hips = cylinder("Hips", 0.4, 0.25, (0, 0, 0.42), armor, verts=20, bevel_width=0.06)
    legs = [cylinder(f"Leg{i}", 0.15, 0.5, (x, 0, 0.22), steel, verts=14, bevel_width=0.04) for i, x in enumerate((-0.18, 0.18))]
    boots = [cube(f"Boot{i}", (0.26, 0.4, 0.14), (x, -0.05, 0.07), leather, bevel_width=0.04) for i, x in enumerate((-0.18, 0.18))]
    head = sphere("Head", 0.3, (0, 0, 1.62), skin)
    helmet = sphere("Helmet", 0.36, (0, 0, 1.7), steel, scale=(1, 1, 0.95))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.3, 1.5))
    cutter = bpy.context.active_object
    cutter.scale = (1.0, 0.5, 0.5)
    apply_scale(cutter)
    boolean_cut(helmet, [cutter])
    visor = cube("Visor", (0.5, 0.08, 0.12), (0, -0.3, 1.6), steel, bevel_width=0.02)
    plume_obj = cone("Plume", 0.09, 0.55, (0, 0, 2.25), plume, verts=10, sub=1)
    shoulders = [sphere(f"Shoulder{i}", 0.2, (x, 0, 1.38), steel, scale=(1.1, 1, 0.8)) for i, x in enumerate((-0.5, 0.5))]
    arms = [cylinder(f"Arm{i}", 0.11, 0.55, (x, -0.02, 1.0), armor, verts=12, bevel_width=0.03) for i, x in enumerate((-0.55, 0.55))]
    gloves = [sphere(f"Glove{i}", 0.13, (x, -0.02, 0.7), leather) for i, x in enumerate((-0.55, 0.55))]
    cape = cube("Cape", (0.78, 0.05, 1.05), (0, 0.4, 0.95), cape_mat, bevel_width=0.02, rot=(0.12, 0, 0), sub=1)
    blade = cube("Blade", (0.07, 0.03, 1.1), (0.62, -0.1, 1.15), steel, bevel_width=0.01)
    guard = cube("Guard", (0.32, 0.07, 0.07), (0.62, -0.1, 0.6), gold, bevel_width=0.02)
    grip = cylinder("Grip", 0.04, 0.26, (0.62, -0.1, 0.45), leather, verts=10, bevel_width=0.005)
    pommel = sphere("Pommel", 0.06, (0.62, -0.1, 0.3), gold)
    shield = cylinder("Shield", 0.34, 0.06, (-0.72, -0.05, 1.0), armor, rot=(0, math.pi / 2, 0), verts=24, bevel_width=0.03)
    emblem = cylinder("Emblem", 0.14, 0.08, (-0.76, -0.05, 1.0), gold, rot=(0, math.pi / 2, 0), verts=16, bevel_width=0.02)
    parts = [torso, chest, belt, buckle, hips, *legs, *boots, head, helmet, visor, plume_obj, *shoulders, *arms, *gloves, cape, blade, guard, grip, pommel, shield, emblem]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Knight"
    face_forward([body])
    r = root("KnightRoot")
    parent([body], r)
    export(r, "knight")


def build_tree(variant):
    bark = material("Bark", "#6b4423", 0.0, 0.95)
    leaves = material("Leaves", "#2f8f3a" if variant == 0 else "#3fa347", 0.0, 0.85)
    trunk = cylinder("Trunk", 0.38, 2.4, (0, 0, 1.2), bark, verts=10, bevel_width=0.04, radius2=0.2)
    roots = [cone(f"Root{i}", 0.22, 0.6, (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.2), bark, verts=6) for i, a in enumerate((0.3, 2.4, 4.5))]
    canopy = []
    if variant == 0:
        for i, (z, r) in enumerate(((3.2, 1.9), (4.4, 1.45), (5.5, 0.95))):
            c = cone(f"Canopy{i}", r, 2.6 - i * 0.3, (0, 0, z), leaves, verts=9, sub=1)
            canopy.append(c)
    else:
        for i, (x, y, z, r) in enumerate(((0, 0, 3.6, 1.6), (0.9, 0.3, 3.0, 1.1), (-0.8, -0.4, 3.1, 1.0), (0.2, -0.9, 4.3, 0.95), (-0.3, 0.8, 4.5, 0.9))):
            canopy.append(ico(f"Canopy{i}", r, (x, y, z), leaves, scale=(1, 1, 0.85), subdivisions=1, sub=1))
    parts = [trunk, *roots, *canopy]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    tree = bpy.context.active_object
    tree.name = "Tree"
    r = root("TreeRoot")
    parent([tree], r)
    export(r, f"tree{variant}")


def build_crystal():
    gem = material("Crystal", "#5ff1ff", 0.1, 0.08, "#1aa8c8", 1.6, coat=1.0, alpha=0.95)
    stone = material("Stone", "#9aa3b5", 0.4, 0.6)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.7, subdivisions=0)
    crystal = bpy.context.active_object
    crystal.scale = (0.8, 0.8, 1.6)
    crystal = finish(crystal, "Crystal", gem, 0.05, 2, smooth_angle=20)
    shards = []
    for i in range(4):
        a = i * math.pi / 2 + 0.5
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.22, subdivisions=0, location=(math.cos(a) * 0.45, math.sin(a) * 0.45, -0.55))
        s = bpy.context.active_object
        s.scale = (0.7, 0.7, 1.6)
        s.rotation_euler = (math.cos(a) * 0.5, math.sin(a) * 0.5, 0)
        shards.append(finish(s, f"Shard{i}", gem, 0.02, 2, smooth_angle=20))
    parts = [crystal, *shards]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = "Crystal"
    r = root("CrystalRoot")
    parent([obj], r)
    export(r, "crystal")


def build_slime():
    goo = material("Goo", "#62d13a", 0.1, 0.25, "#2f7a16", 0.5, coat=1.0, alpha=0.94)
    eye_w = material("EyeWhite", "#ffffff", 0.0, 0.3)
    pupil = material("Pupil", "#111111", 0.2, 0.3)
    body = ico("Body", 0.78, (0, 0, 0.55), goo, scale=(1, 1, 0.78), subdivisions=2, sub=1)
    bump = ico("Bump", 0.3, (0.3, -0.2, 1.0), goo, subdivisions=1, sub=1)
    eyes = [sphere(f"Eye{i}", 0.14, (x, -0.6, 0.72), eye_w) for i, x in enumerate((-0.26, 0.26))]
    pupils = [sphere(f"Pupil{i}", 0.07, (x, -0.72, 0.74), pupil) for i, x in enumerate((-0.26, 0.26))]
    parts = [body, bump, *eyes, *pupils]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = "Slime"
    face_forward([obj])
    r = root("SlimeRoot")
    parent([obj], r)
    export(r, "slime")


def build_astronaut():
    suit = material("Suit", "#f2f4f8", 0.1, 0.55)
    visor = material("Visor", "#1b2a4a", 0.95, 0.05, "#204a8a", 0.8, coat=1.0)
    pack = material("Pack", "#9aa3b5", 0.6, 0.4)
    accent = material("Accent", "#ff8a3d", 0.3, 0.5)
    jet = material("Jet", "#66b3ff", 0.0, 0.3, "#66b3ff", 5.0)
    torso = sphere("Torso", 0.45, (0, 0, 0.1), suit, scale=(0.95, 0.75, 1.1), sub=1)
    chest = cube("Chest", (0.5, 0.2, 0.3), (0, -0.33, 0.25), pack, bevel_width=0.06)
    buttons = [cube(f"Btn{i}", (0.08, 0.05, 0.08), (x, -0.44, 0.28), accent, bevel_width=0.02) for i, x in enumerate((-0.12, 0.0, 0.12))]
    helmet = sphere("Helmet", 0.43, (0, 0, 0.95), suit)
    visor_obj = sphere("Visor", 0.32, (0, -0.2, 0.98), visor, scale=(1, 0.75, 0.85))
    ring = torus("Collar", 0.3, 0.06, (0, 0, 0.55), accent)
    backpack = cube("Backpack", (0.56, 0.32, 0.66), (0, 0.42, 0.3), pack, bevel_width=0.08, segments=4)
    tanks = [cylinder(f"Tank{i}", 0.1, 0.5, (x, 0.6, 0.35), suit, verts=12, bevel_width=0.04) for i, x in enumerate((-0.15, 0.15))]
    nozzles = [cylinder(f"Nozzle{i}", 0.09, 0.14, (x, 0.5, -0.1), jet, verts=12, bevel_width=0.01) for i, x in enumerate((-0.18, 0.18))]
    arms = [sphere(f"Arm{i}", 0.14, (x, -0.02, 0.15), suit, scale=(1, 1, 2.0), sub=1) for i, x in enumerate((-0.55, 0.55))]
    gloves = [sphere(f"Glove{i}", 0.14, (x, -0.02, -0.2), accent) for i, x in enumerate((-0.55, 0.55))]
    legs = [sphere(f"Leg_{tag}", 0.15, (x, 0, -0.55), suit, scale=(1, 1, 1.9), sub=1) for tag, x in (("L", -0.2), ("R", 0.2))]
    boots = [cube(f"Boot{i}", (0.26, 0.38, 0.16), (x, -0.05, -0.9), accent, bevel_width=0.04) for i, x in enumerate((-0.2, 0.2))]
    parts = [torso, chest, *buttons, helmet, visor_obj, ring, backpack, *tanks, *nozzles, *arms, *gloves]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Body"
    for leg, boot in zip(legs, boots):
        activate(leg)
        boot.select_set(True)
        bpy.ops.object.join()
        leg_obj = bpy.context.active_object
        leg_obj.name = leg.name if leg_obj.name.startswith("Leg") else leg_obj.name
        # move origin to hip so rotation swings from the top
        bpy.context.scene.cursor.location = (leg_obj.location.x, 0, -0.3)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = (0, 0, 0)
    legs_objs = [o for o in bpy.data.objects if o.name.startswith("Leg_")]
    face_forward([body, *legs_objs])
    r = root("Astronaut")
    parent([body, *legs_objs], r)
    export(r, "astronaut")


def build_platform():
    metal = material("Deck", "#5a4de0", 0.5, 0.45)
    dark = material("Under", "#1a1540", 0.7, 0.5)
    glow_mat = material("Glow", "#53e0ff", 0.0, 0.3, "#53e0ff", 4.0)
    deck = cube("Deck", (7, 5, 0.7), (0, 0, -0.35), metal, bevel_width=0.12, segments=4)
    inset = cube("Inset", (6.2, 4.2, 0.08), (0, 0, 0.02), dark, bevel_width=0.03)
    strip = cube("Strip", (6.4, 4.4, 0.18), (0, 0, -0.82), glow_mat, bevel_width=0.04)
    under = cube("Under", (5.4, 3.6, 0.5), (0, 0, -1.0), dark, bevel_width=0.1, segments=3)
    emitters = [cylinder(f"Emitter{i}", 0.22, 0.3, (x, y, -1.3), glow_mat, verts=12, bevel_width=0.02) for i, (x, y) in enumerate(((-2.4, -1.5), (2.4, -1.5), (-2.4, 1.5), (2.4, 1.5)))]
    parts = [deck, inset, strip, under, *emitters]
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = "Platform"
    r = root("PlatformRoot")
    parent([obj], r)
    export(r, "platform")


def build_star():
    gold = material("Star", "#ffd54a", 0.7, 0.28, "#ffb300", 2.0, coat=0.6)
    bm = bmesh.new()
    top, bottom = [], []
    for i in range(10):
        r = 0.62 if i % 2 == 0 else 0.3
        a = i / 10 * math.pi * 2 - math.pi / 2
        x, y = math.cos(a) * r, math.sin(a) * r
        top.append(bm.verts.new((x, 0.1, y)))
        bottom.append(bm.verts.new((x, -0.1, y)))
    bm.faces.new(top)
    bm.faces.new(reversed(bottom))
    for i in range(10):
        bm.faces.new((bottom[i], bottom[(i + 1) % 10], top[(i + 1) % 10], top[i]))
    me = bpy.data.meshes.new("Star")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("Star", me)
    bpy.context.collection.objects.link(obj)
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.append(gold)
    bevel(obj, 0.05, 3, angle=20)
    smooth(obj, 30)
    r = root("StarRoot")
    parent([obj], r)
    export(r, "star")


BUILDERS = {
    "car": build_car,
    "sedan": build_sedan,
    "truck": build_truck,
    "ship": build_ship,
    "drone": build_drone,
    "knight": build_knight,
    "tree0": lambda: build_tree(0),
    "tree1": lambda: build_tree(1),
    "crystal": build_crystal,
    "slime": build_slime,
    "astronaut": build_astronaut,
    "platform": build_platform,
    "star": build_star,
}

clear_scene()
for name, builder in BUILDERS.items():
    if ONLY and name not in ONLY:
        continue
    _materials.clear()
    print(f"[models] building {name}")
    builder()
print("[models] done")
