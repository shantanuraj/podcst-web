import { ImageResponse } from 'next/og';
import { top } from '@/app/api/top/top';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default async function Image(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const podcasts = await top(4, params.locale);

  return new ImageResponse(
    <div
      style={{
        background: '#faf9f7',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '80px',
        color: '#1a1a1a',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          maxWidth: '550px',
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontSize: '24px',
            fontFamily: 'sans-serif',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: '#c84b31',
            marginBottom: '32px',
          }}
        >
          Podcst
        </div>
        <div
          style={{
            fontSize: '96px',
            fontFamily: 'serif',
            lineHeight: '1.05',
            fontWeight: 'bold',
            marginBottom: '40px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>Top</span>
          <span>Podcasts</span>
        </div>
        <div
          style={{
            fontSize: '28px',
            fontFamily: 'serif',
            fontStyle: 'italic',
            color: '#6b6b6b',
            lineHeight: '1.4',
          }}
        >
          Listen to the most popular podcasts in the world.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          width: '420px',
          gap: '20px',
          zIndex: 1,
        }}
      >
        {podcasts.map((podcast) => (
          <div
            key={podcast.id}
            style={{
              display: 'flex',
              width: '200px',
              height: '200px',
              border: '1px solid #e8e6e3',
              overflow: 'hidden',
            }}
          >
            <img
              src={podcast.cover}
              alt={podcast.title}
              width="200"
              height="200"
              style={{
                objectFit: 'cover',
              }}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '0',
          left: '0',
          right: '0',
          height: '16px',
          backgroundColor: '#c84b31',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: '40px',
          left: '40px',
          right: '40px',
          bottom: '40px',
          border: '1px solid #e8e6e3',
          pointerEvents: 'none',
        }}
      />
    </div>,
    {
      ...size,
    },
  );
}
