import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 100,
          background: 'white',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 32,
          fontWeight: 600,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ color: '#111827' }}>g</span>
        <span style={{ color: '#E07A5F' }}>.</span>
        <span style={{ color: '#111827' }}>b</span>
      </div>
    ),
    {
      ...size,
    }
  )
}
