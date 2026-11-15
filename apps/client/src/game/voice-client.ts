import {
  VOICE_DROP,
  VOICE_ICE_SERVERS,
  type VoiceEvent,
  type VoiceLevel,
  type VoicePeer,
  type VoiceRequest,
  type VoiceSignal,
  voiceInitiator,
  voiceLevel,
} from '@office-fps/shared'
import * as THREE from 'three'

export interface VoiceDeps {
  hudRoot: HTMLElement
  send: (req: VoiceRequest) => void
  myId: () => number
  /** Where voice plays into (the audio engine's master), or null before the first click. */
  output: () => { ctx: AudioContext; out: AudioNode } | null
  /** Just over player `id`'s head as drawn, or null (not drawn: dead, far, in a car). */
  headOf: (id: number) => THREE.Vector3 | null
  nameOf: (id: number) => string | undefined
  /** You muted them (chat's /mute or a click on their name): you don't hear them either. */
  isMuted: (id: number) => boolean
  /** A line for the player ("No microphone…"). */
  notify: (text: string) => void
}

/** How often the microphone's loudness is sent while talking (ms): the dead hear it. */
const LEVEL_EVERY_MS = 500
/** A radio voice: a narrow band, a little quieter than somebody beside you. */
const RADIO_GAIN = 0.8

/** One voice link: the WebRTC connection and how their voice plays. */
interface Peer {
  id: number
  radio: boolean
  pc: RTCPeerConnection
  /** ICE candidates that came before their session description. */
  pendingIce: RTCIceCandidateInit[]
  /** Chrome only feeds a remote stream to WebAudio while an element plays it (muted). */
  element: HTMLAudioElement | null
  nodes: AudioNode[]
  gain: GainNode | null
  panner: PannerNode | null
  talking: boolean
  tag: HTMLDivElement
}

/**
 * Proximity voice on the client. The server says who to link with (voice-hub, by distance or
 * radio); each link is a direct WebRTC audio connection, the handshake passed through the game
 * socket. A voice plays from where that person stands (a PannerNode at their head), fading out
 * towards VOICE_DROP; over the radio it plays flat and narrow. Push to talk: the microphone
 * track is only live while the key is held. Links that can't connect (strict NATs: there is no
 * relay server) just stay silent.
 */
export class VoiceClient {
  private readonly deps: VoiceDeps
  private readonly peers = new Map<number, Peer>()
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private analyserSource: MediaStreamAudioSourceNode | null = null
  private readonly samples = new Float32Array(1024)
  /** Voice is wanted (the setting) and the microphone was granted. */
  private on = false
  /** Asking for the microphone right now. */
  private asking = false
  private joined = false
  private talking = false
  private loudest = 0
  private levelAt = 0
  private readonly root: HTMLDivElement
  private readonly self: HTMLDivElement
  private readonly projected = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly toward = new THREE.Vector3()

  constructor(deps: VoiceDeps) {
    this.deps = deps
    this.root = document.createElement('div')
    this.root.className = 'hud-voice'
    this.self = document.createElement('div')
    this.self.className = 'hud-voice-self'
    this.self.textContent = 'TRANSMITTING'
    this.self.hidden = true
    this.root.append(this.self)
    deps.hudRoot.append(this.root)
  }

  get enabled(): boolean {
    return this.on
  }

  get transmitting(): boolean {
    return this.talking
  }

  /**
   * The setting changed: switch voice on (asks for the microphone; false if refused) or off.
   */
  async setEnabled(want: boolean): Promise<boolean> {
    if (want === this.on || (want && this.asking)) return this.on
    if (!want) {
      this.on = false
      this.setTalking(false)
      this.closeAll()
      for (const t of this.stream?.getTracks() ?? []) t.stop()
      this.stream = null
      this.analyserSource?.disconnect()
      this.analyserSource = null
      this.analyser = null
      if (this.joined) this.deps.send({ kind: 'on', on: false })
      return false
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.deps.notify('Voice chat needs a browser with microphone access (https).')
      return false
    }
    this.asking = true
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      this.deps.notify('No microphone: voice chat stays off.')
      return false
    } finally {
      this.asking = false
    }
    // Push to talk: silent until the key goes down.
    for (const t of this.stream.getAudioTracks()) t.enabled = false
    this.on = true
    if (this.joined) this.deps.send({ kind: 'on', on: true })
    return true
  }

  /** In a game (Welcome) or out of it (disconnected): the server forgets voice on a reconnect. */
  setJoined(joined: boolean): void {
    this.joined = joined
    if (!joined) {
      this.setTalking(false)
      this.closeAll()
    } else if (this.on) this.deps.send({ kind: 'on', on: true })
  }

  /** Push to talk went down or up. */
  setTalking(down: boolean): void {
    const talking = down && this.on && this.joined
    if (talking === this.talking) return
    this.talking = talking
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = talking
    this.self.hidden = !talking
    this.loudest = 0
    this.levelAt = performance.now()
    this.deps.send(talking ? { kind: 'talk', talking, level: 1 } : { kind: 'talk', talking })
  }

  onEvent(e: VoiceEvent): void {
    if (!this.on) return
    switch (e.kind) {
      case 'peers':
        this.setPeers(e.peers)
        return
      case 'signal':
        void this.onSignal(e.from, e.signal)
        return
      case 'talk': {
        const peer = this.peers.get(e.from)
        if (peer) peer.talking = e.talking
        return
      }
    }
  }

  /** Every frame: voices follow the people talking; the speaking marks; your loudness. */
  update(camera: THREE.Camera, nowMs: number): void {
    if (this.talking) this.measure(nowMs)
    const width = this.root.clientWidth || window.innerWidth
    const height = this.root.clientHeight || window.innerHeight
    camera.getWorldDirection(this.forward)
    const out = this.deps.output()
    let corner = 0
    for (const peer of this.peers.values()) {
      const muted = this.deps.isMuted(peer.id)
      if (out && !peer.gain && peer.element) this.wire(peer, out)
      const head = this.deps.headOf(peer.id)
      if (peer.gain && out) {
        // Out of sight (not drawn, or dead): nothing to place the voice at. Radio plays anyway.
        const audible = !muted && (peer.radio || head !== null)
        peer.gain.gain.setTargetAtTime(
          audible ? (peer.radio ? RADIO_GAIN : 1) : 0,
          out.ctx.currentTime,
          0.05,
        )
        if (peer.panner && head) {
          const t = out.ctx.currentTime
          peer.panner.positionX.setTargetAtTime(head.x, t, 0.03)
          peer.panner.positionY.setTargetAtTime(head.y - 0.25, t, 0.03)
          peer.panner.positionZ.setTargetAtTime(head.z, t, 0.03)
        }
      }
      // The speaking mark: over their head when in view, else in the corner list (the radio).
      const show = peer.talking && !muted
      let placed = false
      if (show && head && !peer.radio) {
        this.toward.copy(head).sub(camera.position)
        if (this.forward.dot(this.toward) > 0) {
          this.projected.copy(head).project(camera)
          peer.tag.style.left = `${((this.projected.x + 1) / 2) * width}px`
          peer.tag.style.top = `${((1 - this.projected.y) / 2) * height}px`
          peer.tag.classList.remove('corner')
          peer.tag.style.removeProperty('--row')
          placed = true
        }
      }
      if (show && !placed) {
        peer.tag.classList.add('corner')
        peer.tag.style.left = ''
        peer.tag.style.top = ''
        peer.tag.style.setProperty('--row', String(corner++))
      }
      peer.tag.hidden = !show
      peer.tag.textContent = placed ? '((·))' : `((·)) ${this.deps.nameOf(peer.id) ?? '?'}`
    }
  }

  /** Who is linked and talking (tests, debugging). */
  debugState(): { id: number; radio: boolean; state: string; talking: boolean }[] {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      radio: p.radio,
      state: p.pc.connectionState,
      talking: p.talking,
    }))
  }

  // --- Links ---------------------------------------------------------------------------

  private setPeers(list: readonly VoicePeer[]): void {
    const wanted = new Map(list.map((p) => [p.id, p]))
    for (const id of [...this.peers.keys()]) if (!wanted.has(id)) this.close(id)
    for (const p of list) {
      const have = this.peers.get(p.id)
      if (have) {
        if (have.radio !== !!p.radio) {
          // Walked into earshot (or out of it): the same link, played the other way.
          have.radio = !!p.radio
          this.unwire(have)
        }
        continue
      }
      this.open(p)
    }
  }

  private open(p: VoicePeer): void {
    const pc = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS })
    const tag = document.createElement('div')
    tag.className = 'hud-voice-tag'
    tag.hidden = true
    this.root.append(tag)
    const peer: Peer = {
      id: p.id,
      radio: !!p.radio,
      pc,
      pendingIce: [],
      element: null,
      nodes: [],
      gain: null,
      panner: null,
      talking: false,
      tag,
    }
    this.peers.set(p.id, peer)
    const stream = this.stream
    if (stream) for (const track of stream.getAudioTracks()) pc.addTrack(track, stream)
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const c = e.candidate.toJSON()
      this.signal(p.id, {
        ice: {
          candidate: c.candidate ?? '',
          sdpMid: c.sdpMid ?? null,
          sdpMLineIndex: c.sdpMLineIndex ?? null,
        },
      })
    }
    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track])
      const element = new Audio()
      element.srcObject = remote
      element.muted = true
      void element.play().catch(() => {})
      peer.element = element
      const out = this.deps.output()
      if (out) this.wire(peer, out)
    }
    if (voiceInitiator(this.deps.myId(), p.id)) void this.offer(peer)
  }

  private async offer(peer: Peer): Promise<void> {
    try {
      const offer = await peer.pc.createOffer()
      await peer.pc.setLocalDescription(offer)
      if (offer.sdp) this.signal(peer.id, { sdp: { type: 'offer', sdp: offer.sdp } })
    } catch {
      // A link that can't start stays silent; the next peers update may try again.
    }
  }

  private async onSignal(from: number, signal: VoiceSignal): Promise<void> {
    const peer = this.peers.get(from)
    if (!peer) return
    const pc = peer.pc
    try {
      if ('sdp' in signal) {
        await pc.setRemoteDescription(signal.sdp)
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c)
        if (signal.sdp.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          if (answer.sdp) this.signal(from, { sdp: { type: 'answer', sdp: answer.sdp } })
        }
      } else {
        const c: RTCIceCandidateInit = {
          candidate: signal.ice.candidate,
          sdpMid: signal.ice.sdpMid ?? null,
          sdpMLineIndex: signal.ice.sdpMLineIndex ?? null,
        }
        if (pc.remoteDescription) await pc.addIceCandidate(c)
        else peer.pendingIce.push(c)
      }
    } catch {
      // A bad step from the other end: this link stays silent.
    }
  }

  private signal(to: number, signal: VoiceSignal): void {
    this.deps.send({ kind: 'signal', to, signal })
  }

  /** Their voice into the mix: placed in the world, or flat and narrow over the radio. */
  private wire(peer: Peer, out: { ctx: AudioContext; out: AudioNode }): void {
    const remote = peer.element?.srcObject
    if (!(remote instanceof MediaStream) || peer.gain) return
    const { ctx } = out
    const source = ctx.createMediaStreamSource(remote)
    const gain = new GainNode(ctx, { gain: 0 })
    peer.nodes = [source, gain]
    if (peer.radio) {
      const low = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 400 })
      const high = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2800 })
      source.connect(low).connect(high).connect(gain)
      peer.nodes.push(low, high)
      peer.panner = null
    } else {
      const panner = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'linear',
        refDistance: 2,
        maxDistance: VOICE_DROP,
        rolloffFactor: 1,
      })
      source.connect(panner).connect(gain)
      peer.nodes.push(panner)
      peer.panner = panner
    }
    gain.connect(out.out)
    peer.gain = gain
  }

  private unwire(peer: Peer): void {
    for (const n of peer.nodes) n.disconnect()
    peer.nodes = []
    peer.gain = null
    peer.panner = null
  }

  private close(id: number): void {
    const peer = this.peers.get(id)
    if (!peer) return
    this.unwire(peer)
    peer.pc.close()
    if (peer.element) peer.element.srcObject = null
    peer.tag.remove()
    this.peers.delete(id)
  }

  private closeAll(): void {
    for (const id of [...this.peers.keys()]) this.close(id)
  }

  // --- Your loudness ---------------------------------------------------------------------

  /** Keeps the loudest moment and sends it every LEVEL_EVERY_MS (the dead hear shouting). */
  private measure(nowMs: number): void {
    const analyser = this.localAnalyser()
    if (analyser) {
      analyser.getFloatTimeDomainData(this.samples)
      let sum = 0
      for (const v of this.samples) sum += v * v
      this.loudest = Math.max(this.loudest, Math.sqrt(sum / this.samples.length))
    }
    if (nowMs - this.levelAt < LEVEL_EVERY_MS) return
    this.levelAt = nowMs
    const level: VoiceLevel = analyser ? voiceLevel(this.loudest) : 1
    this.loudest = 0
    this.deps.send({ kind: 'talk', talking: true, level })
  }

  private localAnalyser(): AnalyserNode | null {
    if (this.analyser || !this.stream) return this.analyser
    const out = this.deps.output()
    if (!out) return null
    // Listens only: never connected to the speakers (you'd hear yourself).
    this.analyserSource = out.ctx.createMediaStreamSource(this.stream)
    this.analyser = new AnalyserNode(out.ctx, { fftSize: this.samples.length })
    this.analyserSource.connect(this.analyser)
    return this.analyser
  }
}
