import type GUI from 'lil-gui'
import type { RemotePlayers } from '../game/remote-players.ts'
import type { Connection } from '../net/connection.ts'

/** Fake latency/jitter and interpolation delay, for testing netcode on localhost. Not saved. */
export function addNetworkFolder(gui: GUI, net: Connection, remotes: RemotePlayers): void {
  const folder = gui.addFolder('Network test (not saved)')
  folder.add(net.sim, 'latencyMs', 0, 300, 5).name('added latency, one way (ms)')
  folder.add(net.sim, 'jitterMs', 0, 100, 1).name('added jitter (ms)')
  folder.add(remotes, 'interpDelayMs', 34, 300, 1).name('interpolation delay (ms)')
  const presets = {
    lan: () => set(0, 0),
    wifi: () => set(15, 10),
    remote: () => set(75, 20),
    bad: () => set(150, 50),
  }
  const set = (latency: number, jitter: number) => {
    net.sim.latencyMs = latency
    net.sim.jitterMs = jitter
    for (const c of folder.controllersRecursive()) c.updateDisplay()
  }
  folder.add(presets, 'lan').name('preset: LAN')
  folder.add(presets, 'wifi').name('preset: office Wi-Fi')
  folder.add(presets, 'remote').name('preset: 150 ms RTT')
  folder.add(presets, 'bad').name('preset: 300 ms RTT + jitter')
  folder.close()
}
