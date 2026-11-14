import {
  clamp,
  cos,
  Fn,
  If,
  instancedBufferAttribute,
  Loop,
  max,
  positionGeometry,
  positionLocal,
  renderGroup,
  select,
  sin,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl'
import {
  InstancedBufferAttribute,
  type InstancedMesh,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import { CORN_HEIGHT, CORN_MAX_PUSHERS, CORN_PUSH_RADIUS, cornUniforms } from './corn.ts'

/*
 * TSL twin of the corn's vertex patch (corn.ts) for the WebGPU renderer. Runs after instancing
 * (positionLocal is already the stalk placed in the field), like the GLSL one.
 */

// Render group: the field never changes, so per-object uniforms would never be refreshed.
const time = uniform(0)
  .setGroup(renderGroup)
  .onRenderUpdate(() => cornUniforms.uTime.value)
const pushers = uniformArray(cornUniforms.uPushers.value, 'vec3').setGroup(renderGroup)
/** Root (x, z) of every stalk, read once from the instance matrices: the field never moves. */
const roots = new WeakMap<InstancedMesh, InstancedBufferAttribute>()

function rootsOf(mesh: InstancedMesh): InstancedBufferAttribute {
  let attr = roots.get(mesh)
  if (!attr) {
    const m = mesh.instanceMatrix.array
    const xz = new Float32Array(mesh.count * 2)
    for (let i = 0; i < mesh.count; i++) {
      xz[i * 2] = m[i * 16 + 12] ?? 0
      xz[i * 2 + 1] = m[i * 16 + 14] ?? 0
    }
    attr = new InstancedBufferAttribute(xz, 2)
    roots.set(mesh, attr)
  }
  return attr
}

export const cornPosition = (): Node<'vec3'> =>
  Fn((builder: NodeBuilder) => {
    const root = instancedBufferAttribute(rootsOf(builder.object as InstancedMesh)) as Node<'vec2'>
    const bend = clamp(positionGeometry.y.div(CORN_HEIGHT), 0, 1)
    const bend2 = bend.mul(bend)
    const sway = vec2(
      sin(time.mul(1.1).add(root.x.mul(0.31)).add(root.y.mul(0.17)))
        .mul(0.07)
        .add(sin(time.mul(2.9).add(root.y.mul(0.8))).mul(0.02)),
      sin(time.mul(0.9).add(root.y.mul(0.27))).mul(0.05),
    ).toVar()
    Loop(CORN_MAX_PUSHERS, ({ i }) => {
      const p = pushers.element(i) as unknown as Node<'vec3'>
      If(p.z.greaterThan(0), () => {
        const away = root.sub(p.xy)
        const d = away.length()
        const k = p.z.mul(max(0, d.div(CORN_PUSH_RADIUS).oneMinus()))
        If(k.greaterThan(0), () => {
          const dir = select(d.greaterThan(0.01), away.div(d), vec2(1, 0))
          // Bent aside, plus a shiver: corn being shoved through rustles.
          sway.addAssign(
            dir
              .mul(k)
              .mul(0.55)
              .add(
                vec2(sin(time.mul(17).add(root.x.mul(5))), cos(time.mul(15).add(root.y.mul(5))))
                  .mul(k)
                  .mul(0.08),
              ),
          )
        })
      })
    })
    return vec3(
      positionLocal.x.add(sway.x.mul(bend2)),
      positionLocal.y,
      positionLocal.z.add(sway.y.mul(bend2)),
    )
  })()
