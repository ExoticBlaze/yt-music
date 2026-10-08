export function fadeCurve(from: number, to: number, direction: 'in' | 'out'): Float32Array {
  const values = new Float32Array(129);
  for (let index = 0; index < values.length; index++) {
    const angle = ((index / (values.length - 1)) * Math.PI) / 2;
    values[index] =
      direction === 'in'
        ? from + (to - from) * Math.sin(angle)
        : to + (from - to) * Math.cos(angle);
  }
  values[0] = from;
  values[values.length - 1] = to;
  return values;
}
