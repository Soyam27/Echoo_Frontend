'use client'
import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false })

export default function SplineScene() {
  const [loaded, setLoaded] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setSize({ w: window.innerWidth, h: window.innerHeight })
  }, [])

  if (!size) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '45%',
        width: size.w * 1.5,
        height: size.h * 1.5,
        transform: 'translate(-50%, -50%) scale(1.5)',
        transformOrigin: 'center center',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 2s ease-in',
      }}
    >
      <Spline
        scene="https://prod.spline.design/2pFi601zJXupNgaB/scene.splinecode"
        style={{ width: '100%', height: '100%' }}
        onLoad={() => setTimeout(() => setLoaded(true), 400)}
      />
    </div>
  )
}
