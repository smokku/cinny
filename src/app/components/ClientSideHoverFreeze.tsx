import React, { useEffect, useRef, useState } from 'react';

type ClientSideHoverFreezeProps = {
  children: React.ReactNode;
  src: string;
  className?: string;
};

export function ClientSideHoverFreeze({ children, src, className }: ClientSideHoverFreezeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCanvasReady, setIsCanvasReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = src;

    img.onload = () => {
      if (isMounted && canvasRef.current) {
        canvasRef.current.width = img.naturalWidth || img.width;
        canvasRef.current.height = img.naturalHeight || img.height;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0);
        }
        setIsCanvasReady(true);
      }
    };

    return () => {
      isMounted = false;
    };
  }, [src]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        cursor: 'pointer',
        verticalAlign: 'middle',
        overflow: 'hidden',
        borderRadius: 'inherit',
      }}
    >
      <div
        style={{
          opacity: isHovered || !isCanvasReady ? 1 : 0,
          display: 'flex',
          width: '100%',
        }}
      >
        {children}
      </div>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'inherit',
          opacity: !isHovered && isCanvasReady ? 1 : 0,
          pointerEvents: 'none',
          display: 'block',
        }}
      />
    </div>
  );
}
