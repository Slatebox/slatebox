/* eslint-disable max-classes-per-file */
/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/* eslint-disable react/no-this-in-sfc */
import React, { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import Box from '@mui/material/Box'
import { Slatebox } from 'slateboxjs'
import {
  outstandingAIRequests,
  slateBackgroundColorAtom,
} from '../../jotai/atoms'
import PropTypes from 'prop-types'

// convert hex to rgb
function convertHexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

// Add these utilities at the top
const PARTICLE_POOL_SIZE = 60
const THROTTLE_TIME = 100 // ms

// Define Particle class first
class Particle {
  constructor(canvas) {
    this.reset(canvas)
  }

  reset(canvas) {
    if (!canvas) return
    this.x = Math.random() * canvas.width
    this.y = Math.random() * canvas.height
    this.vx = (Math.random() - 0.5) * 0.3
    this.vy = (Math.random() - 0.5) * 0.3
    this.ax = 0
    this.ay = 0
    this.size = Math.random() * 2 + 0.5
    this.life = Math.random() * 150 + 150
    this.maxLife = this.life
    this.pulsePhase = Math.random() * Math.PI * 2
    this.pulseSpeed = 0.05 + Math.random() * 0.05
  }

  shouldReset(canvas) {
    return (
      this.life < 0 ||
      this.x < -50 ||
      this.x > canvas.width + 50 ||
      this.y < -50 ||
      this.y > canvas.height + 50
    )
  }

  update() {
    this.pulsePhase += this.pulseSpeed
    this.ax += (Math.random() - 0.5) * 0.01
    this.ay += (Math.random() - 0.5) * 0.01
    this.ax *= 0.95
    this.ay *= 0.95
    this.vx += this.ax
    this.vy += this.ay
    this.vx *= 0.98
    this.vy *= 0.98
    this.x += this.vx
    this.y += this.vy
    this.life -= 1
  }

  draw(ctx, { r, g, b }) {
    const pulseIntensity = (Math.sin(this.pulsePhase) + 1) * 0.5
    const glowSize = this.size * (1 + pulseIntensity)
    // Draw outer glow
    const gradient = ctx.createRadialGradient(
      this.x,
      this.y,
      0,
      this.x,
      this.y,
      glowSize * 4
    )
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(this.x, this.y, glowSize * 4, 0, Math.PI * 2)
    ctx.fill()

    // Draw core
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.7 + pulseIntensity * 0.3})`
    ctx.beginPath()
    ctx.arc(this.x, this.y, glowSize, 0, Math.PI * 2)
    ctx.fill()
  }

  createConnections(particles, canvas, callback) {
    particles.forEach((particle) => {
      const dx = this.x - particle.x
      const dy = this.y - particle.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < 200) {
        callback(this, particle)
      }
    })
  }
}

// Define Neuron class second
class Neuron {
  constructor(startParticle, endParticle) {
    this.init(startParticle, endParticle)
  }

  init(startParticle, endParticle) {
    this.startParticle = startParticle
    this.endParticle = endParticle
    this.progress = 0
    this.speed = 0.02 + Math.random() * 0.02
    this.size = 2 + Math.random() * 2
    this.pulsePhase = Math.random() * Math.PI * 2
  }

  update() {
    this.progress += this.speed
    this.pulsePhase += 0.1
    return this.progress <= 1
  }

  draw(ctx, { r, g, b }) {
    const x =
      this.startParticle.x +
      (this.endParticle.x - this.startParticle.x) * this.progress
    const y =
      this.startParticle.y +
      (this.endParticle.y - this.startParticle.y) * this.progress

    const pulseIntensity = (Math.sin(this.pulsePhase) + 1) * 0.5
    const glowSize = this.size * (1 + pulseIntensity)
    // Draw outer glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowSize * 4)
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`)
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, glowSize * 4, 0, Math.PI * 2)
    ctx.fill()

    // Draw core
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.7 + pulseIntensity * 0.3})`
    ctx.beginPath()
    ctx.arc(x, y, glowSize, 0, Math.PI * 2)
    ctx.fill()
  }
}

// Then define ObjectPool
class ObjectPool {
  constructor(factory, size) {
    this.pool = Array.from({ length: size }, factory)
    this.active = new Set()
  }

  acquire() {
    const object = this.pool.find((obj) => !this.active.has(obj))
    if (object) {
      this.active.add(object)
      return object
    }
    return null
  }

  release(object) {
    this.active.delete(object)
    object.reset?.()
  }

  getActiveObjects() {
    return Array.from(this.active)
  }
}

function whiteOrBlack(color) {
  const wb = Slatebox.utils.whiteOrBlack(color)
  if (wb === '#000000') {
    return '#333333'
  }
  return '#ffffff'
}

function NeuralThinking() {
  const canvasRef = useRef(null)
  const animationFrameRef = useRef(null)
  const particlePoolRef = useRef(null)
  const neuronPoolRef = useRef(null)
  const lastNeuronCreationRef = useRef(0)
  const resizeTimeoutRef = useRef(null)
  const areAIRequestsOutstanding = useAtomValue(outstandingAIRequests)
  const [baseColor, setBaseColor] = React.useState('#333333')
  const getSlateBackgroundColor = useAtomValue(slateBackgroundColorAtom)

  useEffect(() => {
    setBaseColor(whiteOrBlack(getSlateBackgroundColor))
  }, [getSlateBackgroundColor])

  useEffect(() => {
    if (!areAIRequestsOutstanding) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
      // Clear pools when animation stops
      if (particlePoolRef.current) {
        particlePoolRef.current.active.clear()
      }
      if (neuronPoolRef.current) {
        neuronPoolRef.current.active.clear()
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // Debounced resize handler
    const resize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        // Adjust particle count based on screen size
        const area = window.innerWidth * window.innerHeight
        const baseArea = 1920 * 1080
        const particleCount = Math.min(
          PARTICLE_POOL_SIZE,
          Math.floor(PARTICLE_POOL_SIZE * (area / baseArea))
        )

        // Reset pools with new size
        particlePoolRef.current = new ObjectPool(
          () => new Particle(canvas),
          particleCount
        )
        neuronPoolRef.current = new ObjectPool(
          () => new Neuron(null, null),
          particleCount
        )

        // Initialize particles
        for (let i = 0; i < particleCount; i += 1) {
          particlePoolRef.current.acquire()
        }
      }, 250)
    }

    window.addEventListener('resize', resize)
    resize()

    // Initialize object pools if not already created
    if (!particlePoolRef.current) {
      particlePoolRef.current = new ObjectPool(
        () => new Particle(canvas),
        PARTICLE_POOL_SIZE
      )
      neuronPoolRef.current = new ObjectPool(
        () => new Neuron(null, null),
        PARTICLE_POOL_SIZE
      )

      // Initialize particles
      for (let i = 0; i < PARTICLE_POOL_SIZE; i += 1) {
        particlePoolRef.current.acquire()
      }
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const { r, g, b } = convertHexToRgb(baseColor)

      // Update and draw particles
      const activeParticles = particlePoolRef.current.getActiveObjects()
      const activeNeurons = neuronPoolRef.current.getActiveObjects()

      // Draw connections between particles
      activeParticles.forEach((particle) => {
        particle.createConnections(activeParticles, canvas, (p1, p2) => {
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance < 200) {
            // Draw connection line with opacity based on distance
            const opacity = 1 - distance / 200
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity * 0.2})`
            ctx.lineWidth = 1
            ctx.stroke()

            // Create neuron if conditions are met
            const now = Date.now()
            if (
              now - lastNeuronCreationRef.current > THROTTLE_TIME &&
              Math.random() < 0.002
            ) {
              const neuron = neuronPoolRef.current.acquire()
              if (neuron) {
                neuron.init(p1, p2)
                lastNeuronCreationRef.current = now
              }
            }
          }
        })
      })

      // Update and filter neurons
      activeNeurons.forEach((neuron) => {
        if (!neuron.update()) {
          neuronPoolRef.current.release(neuron)
        }
      })

      // Update and draw particles
      activeParticles.forEach((particle) => {
        particle.update()
        if (particle.shouldReset(canvas)) {
          particle.reset(canvas)
        }
        particle.draw(ctx, { r, g, b })
      })

      // Draw neurons
      activeNeurons.forEach((neuron) => neuron.draw(ctx, { r, g, b }))

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [areAIRequestsOutstanding, baseColor])

  return (
    areAIRequestsOutstanding && (
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          width: '100%',
          height: '100%',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
          }}
        />
      </Box>
    )
  )
}

export default NeuralThinking
