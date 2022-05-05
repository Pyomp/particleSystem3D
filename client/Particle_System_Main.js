
import { Array_Tween } from '../utils/math/Tween.js'
import { Worker_Manager } from './modules/Worker_Manager.js'
import {
    BufferAttribute,
    BufferGeometry,
    Points,
    Scene,
    ShaderMaterial,
    Texture,
    Vector3
} from './modules_3D/three.module.js'
import { p_default } from './param_default.js'
import { WORKER_CMD_PARTICLE, WORKER_INSTANCE_CONTROL } from './worker/constants.js'

export class Particle_System_Main {

    /**
     * 
     * @param {Worker_Manager} worker_manager 
     * @param {Scene} scene 
     * @param {*} count 
     * @param {*} position_base 
     * @param {*} position_spread 
     * @param {*} velocity_base 
     * @param {*} velocity_spread 
     */
    constructor(
        worker_manager,
        loop_manager,
        scene,

        p = p_default
    ) {

        this.count = p.count || p_default.count
        this.position_base = p.position_base || p_default.position_base
        this.position_spread = p.position_spread || p_default.position_spread

        this.velocity_base = p.velocity_base || p_default.velocity_base
        this.velocity_spread = p.velocity_spread || p_default.velocity_spread

        this.acceleration_tween = p.acceleration_tween || p_default.acceleration_tween

        const data_sab = new SharedArrayBuffer(4 * 2)
        const position_sab = new SharedArrayBuffer(this.count * 3 * 4)
        const velocity_sab = new SharedArrayBuffer(this.count * 3 * 4)
        const acceleration_sab = new SharedArrayBuffer(this.count * 3 * 4)
        const time_sab = new SharedArrayBuffer(this.count * 4)

        const data_ui32a = new Uint32Array(data_sab)
        const position_f32a = new Float32Array(position_sab)
        const velocity_f32a = new Float32Array(velocity_sab)
        const acceleration_f32a = new Float32Array(acceleration_sab)
        const time_f32a = new Float32Array(time_sab)

        let worker_id
        this.init = async () => {
            worker_id = await worker_manager.request(WORKER_CMD_PARTICLE, {
                p: p,

                data_sab: data_sab,
                position_sab: position_sab,
                velocity_sab: velocity_sab,
                acceleration_sab: acceleration_sab,
                time_sab: time_sab,
            })
        }

        this.start = () => {
            loop_manager.frame_updates.add(update)
            clearTimeout(timeout)
            points.visible = true
            worker_manager.send(WORKER_INSTANCE_CONTROL, {
                id: worker_id,
                prop: 'start',
            })
        }

        let timeout
        this.stop = () => {
            worker_manager.send(WORKER_INSTANCE_CONTROL, {
                id: worker_id,
                prop: 'stop',
            })
            clearTimeout(timeout)
            timeout = setTimeout(() => {
                points.visible = false
                loop_manager.frame_updates.delete(update)
            }, 1500)
        }

        const particleGeometry = new BufferGeometry()
        particleGeometry.setAttribute('position', new BufferAttribute(position_f32a, 3))
        particleGeometry.setAttribute('velocity', new BufferAttribute(velocity_f32a, 3))
        particleGeometry.setAttribute('acceleration', new BufferAttribute(acceleration_f32a, 3))
        particleGeometry.setAttribute('time', new BufferAttribute(time_f32a, 1))

        const img = new Image(64, 64)
        img.src = new URL('./texture.svg', import.meta.url).href
        const tex = new Texture(img)
        tex.flipY = false
        img.onload = () => { tex.needsUpdate = true }

        const uniforms = {
            sync: { value: 0 },
            color: {
                value: [
                    0, 1, 0, 0, 1,
                    0.33, 0, 1, 0, 1,
                    0.66, 0, 0, 1, 1,
                    1, 1, 0, 0, 1,
                ]
            },
            acceleration: {
                value: [
                    0, 1, 0, 0,
                    0.33, 0, 1, 0,
                    0.66, 0, 0, 1,
                    1, 1, 0, 0,
                ]
            },
            pointTexture: {
                value: tex
            }
        }

        const mat = new ShaderMaterial(
            {
                uniforms: uniforms,
                vertexShader:
                   /* glsl */ `
            attribute vec3 velocity;
            uniform float acceleration[${uniforms.acceleration.value.length}];

            attribute float time;
            varying float vTime;

            uniform float sync;
            varying float vSync;

            varying vec2 vuv_offset;

            void main()
            {    
                float a = mod(float(gl_VertexID), 4.);
                if( a == 0. ){
                    vuv_offset.x = 0.5;
                    vuv_offset.y = 0.5;
                } else if (a == 1.){
                    vuv_offset.x = 0.5;
                } else if (a == 2.){
                    vuv_offset.y = 0.5;
                }

                vTime = time;
                vSync = sync;
                vec3 velocity_accelerated = velocity + acceleration * sync;
                vec4 mvPosition = modelViewMatrix * vec4( position + velocity_accelerated * sync, 1.0 );
                gl_PointSize =  300.0 / length( mvPosition.xyz );
                gl_Position = projectionMatrix * mvPosition;
            }`,
                fragmentShader: /* glsl */`
            uniform float color[${uniforms.color.value.length}]; 
            uniform sampler2D pointTexture;

            varying float vTime;
            varying float vSync;
            varying vec2 vuv_offset;

            void main()
            {
                float t = vTime + vSync;

                int index = 0;
                
                while( t > color[index * 5] ) {
                    index++;
                    if((index * 5) >= ${uniforms.color.value.length}) break;
                }

                vec2 uv = vec2(gl_PointCoord.x/2. + vuv_offset.x, gl_PointCoord.y/2. + vuv_offset.y);
                gl_FragColor = texture2D( pointTexture, uv );
  
                if(index == 0){ 

                    gl_FragColor *= vec4(color[1], color[2], color[3], color[4]);

                } else if (index >= ${uniforms.color.value.length} / 5 ) {

                    int i = ${uniforms.color.value.length} - 5;
                    gl_FragColor *= vec4(color[i+1], color[i+2], color[i+3], color[i+4]);

                } else {

                    vec4 before_color = vec4(
                        color[(index - 1) * 5 + 1],
                        color[(index - 1) * 5 + 2],
                        color[(index - 1) * 5 + 3],
                        color[(index - 1) * 5 + 4]);

                    vec4 after_color = vec4(
                        color[index * 5 + 1],
                        color[index * 5 + 2],
                        color[index * 5 + 3],
                        color[index * 5 + 4]);

                    float x = ( t - color[ (index - 1) * 5 ] ) / ( color[ index  * 5 ] - color[ (index - 1) * 5 ] );
                   
                    gl_FragColor *= mix(before_color, after_color, x);
                }                
            }`,
                transparent: true,
                // blending: AdditiveBlending,
                depthWrite: false,
                // vertexColors: true,
            })

        const points = new Points(particleGeometry, mat)
        scene.add(points)

        let last_update = 0
        const update = (dt) => {
            if (data_ui32a[0] === last_update) {

                mat.uniforms.sync.value += dt

            } else {
                mat.uniforms.sync.value = 0
                last_update = data_ui32a[0]
                particleGeometry.attributes.position.needsUpdate = true
                particleGeometry.attributes.velocity.needsUpdate = true
                particleGeometry.attributes.acceleration.needsUpdate = true
                particleGeometry.attributes.time.needsUpdate = true
            }
        }
    };
}
