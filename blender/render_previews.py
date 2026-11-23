"""Render a turntable-style preview PNG for every GLB in a folder (for visual QA).

    blender --background --python render_previews.py -- <models-dir> <out-dir>
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
MODELS = Path(args[0])
OUT = Path(args[1])
OUT.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.resolution_x = scene.render.resolution_y = 420
scene.render.film_transparent = False
scene.view_settings.view_transform = "Filmic" if "Filmic" in [i.identifier for i in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "AgX"

for glb in sorted(MODELS.glob("*.glb")):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    size = max(hi - lo)
    # world
    world = bpy.data.worlds.new("W") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.05, 0.06, 0.1, 1)
    bg.inputs[1].default_value = 1.0
    # lights
    bpy.ops.object.light_add(type="SUN", location=(4, -4, 8))
    sun = bpy.context.active_object
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(35))
    bpy.ops.object.light_add(type="AREA", location=center + Vector((-3, -3, 3)) * size)
    fill = bpy.context.active_object
    fill.data.energy = 300 * size * size
    fill.data.size = size * 2
    # camera
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    scene.camera = cam
    direction = Vector((1.0, -1.4, 0.75)).normalized()
    cam.location = center + direction * size * 2.1
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 45
    # ground
    bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(center.x, center.y, lo.z))
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("Ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.14, 0.2, 1)
    plane.data.materials.append(mat)
    scene.render.filepath = str(OUT / f"{glb.stem}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[preview] {glb.stem} -> {scene.render.filepath}")
print("[preview] done")
