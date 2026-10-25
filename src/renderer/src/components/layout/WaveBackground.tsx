/**
 * Slow, ambient motion behind the interface, in the spirit of the PlayStation 4
 * "dynamic theme": three bands of thin wave lines drifting at different speeds and two
 * soft accent glows. Pure CSS animation on compositor-friendly transforms, paused when
 * the window is hidden, and frozen for reduced motion. Hero artwork covers it; it shows on
 * library, collection and settings screens.
 */
function wavePath(amplitude: number, wavelength: number, baseline: number, width = 3200): string {
  let d = `M0,${baseline} Q${wavelength / 4},${baseline - amplitude} ${wavelength / 2},${baseline}`
  for (let x = wavelength; x <= width; x += wavelength / 2) d += ` T${x},${baseline}`
  return d
}

// Each layer's wavelength divides 1600 so the 50% horizontal drift loops without a seam.
const LAYERS = [
  { id: 'a', amplitude: 70, wavelength: 1600, baselines: [150, 175, 200] },
  { id: 'b', amplitude: 48, wavelength: 800, baselines: [140, 160] },
  { id: 'c', amplitude: 34, wavelength: 400, baselines: [130, 146, 162] }
] as const

export function WaveBackground() {
  return (
    <div className="waves" aria-hidden="true">
      <div className="waves__glow waves__glow--a" />
      <div className="waves__glow waves__glow--b" />
      {LAYERS.map((layer) => (
        <svg key={layer.id} className={`waves__layer waves__layer--${layer.id}`} viewBox="0 0 3200 300" preserveAspectRatio="none">
          {layer.baselines.map((baseline, index) => (
            <path key={baseline} className={`wave wave--${index}`} d={wavePath(layer.amplitude, layer.wavelength, baseline)} />
          ))}
        </svg>
      ))}
    </div>
  )
}
