import React from 'react'
import { Box, keyframes } from '@mui/material'
import { styled } from '@mui/material/styles'

const slideFromRight = keyframes`
  from {
    transform: translateX(60px);
    opacity: 0;
    fill: rgb(255, 255, 255) !important;
  }
  to {
    transform: translateX(0);
    opacity: 1;
    fill: rgb(251, 204, 136) !important;
  }
`

const slideFromTop = keyframes`
  from {
    transform: translateY(-100px);
    opacity: 0;
    fill: rgb(255, 255, 255) !important;
  }
  to {
    transform: translateY(0);
    opacity: 1;
    fill: rgb(251, 204, 136) !important;
  }
`

const slideFromBottom = keyframes`
  from {
    transform: translateY(100px);
    opacity: 0;
    fill: rgb(255, 255, 255) !important;
  }
  to {
    transform: translateY(0);
    opacity: 1;
    fill: rgb(251, 204, 136) !important;
  }
`

const AnimatedPath = styled('path')(({ delay, animation }) => ({
  animation: `${animation} 0.8s ease-in-out ${delay}s forwards`,
  opacity: 0,
}))

const LogoContainer = styled(Box)(() => ({
  position: 'relative',
  width: '200px',
  height: '200px',
  borderTop: '0.5px solid',
  borderBottom: '0.5px solid',
  marginBottom: '20px',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '100%',
    height: '100%',
    background:
      'radial-gradient(circle, rgb(172 172 172 / 5%) 0%, rgba(171, 171, 171, 0.1) 30%, rgba(255, 255, 255, 0) 70%)',
  },
}))

export default function AnimatedLogo() {
  return (
    <LogoContainer>
      <svg
        viewBox="625.886 -21.412 151.562 136.888"
        style={{ width: '100%', height: '100%' }}
      >
        <desc>Created with Fabric.js 2.3.6</desc>
        <g
          id="text-1"
          transform="matrix(1.117066, 0, 0, 1.117066, 1154.030884, 151.216248)"
        />
        <g
          id="group-1"
          transform="matrix(2.427425, 0, 0, 2.356704, 742.611389, 123.436256)"
        >
          <g>
            <g transform="matrix(1, 0, 0, 1, -17.03735, -31.59182)">
              <AnimatedPath
                d="M 16.489 15.372 L 1.596 15.372 L 1.596 22.819 L 16.489 22.819 L 16.489 15.372 Z"
                style={{
                  stroke: 'none',
                  strokeWidth: 1,
                  strokeDasharray: 'none',
                  strokeLinecap: 'butt',
                  strokeLinejoin: 'miter',
                  strokeMiterlimit: 4,
                  fillRule: 'nonzero',
                  fill: 'rgb(251, 204, 136)',
                }}
                animation={slideFromBottom}
                delay={0.1}
              />
              <AnimatedPath
                d="M -1.596 -18.032 L -16.489 -18.032 L -16.489 -10.585 L -1.596 -10.585 L -1.596 -18.032 Z"
                style={{
                  stroke: 'none',
                  strokeWidth: 1,
                  strokeDasharray: 'none',
                  strokeLinecap: 'butt',
                  strokeLinejoin: 'miter',
                  strokeMiterlimit: 4,
                  fillRule: 'nonzero',
                  fill: 'rgb(251, 204, 136)',
                }}
                animation={slideFromTop}
                delay={0.1}
              />
              <AnimatedPath
                d="M 16.489 -2.606 L 1.596 -2.606 L 1.596 12.287 L 16.489 12.287 L 16.489 -2.606 Z"
                style={{
                  stroke: 'none',
                  strokeWidth: 1,
                  strokeDasharray: 'none',
                  strokeLinecap: 'butt',
                  strokeLinejoin: 'miter',
                  strokeMiterlimit: 4,
                  fillRule: 'nonzero',
                  fill: 'rgb(251, 204, 136)',
                }}
                animation={slideFromTop}
                delay={0}
              />
              <AnimatedPath
                d="M -1.596 -7.394 L -25 -7.394 L -25 13.883 L -1.596 13.883 L -1.596 -7.394 Z"
                style={{
                  stroke: 'none',
                  strokeWidth: 1,
                  strokeDasharray: 'none',
                  strokeLinecap: 'butt',
                  strokeLinejoin: 'miter',
                  strokeMiterlimit: 4,
                  fillRule: 'nonzero',
                  fill: 'rgb(251, 204, 136)',
                }}
                animation={slideFromBottom}
                delay={0}
              />
              <AnimatedPath
                d="M 25 -22.819 L 1.596 -22.819 L 1.596 -5.798 L 25 -5.798 L 25 -22.819 Z"
                style={{
                  stroke: 'none',
                  strokeWidth: 1,
                  strokeDasharray: 'none',
                  strokeLinecap: 'butt',
                  strokeLinejoin: 'miter',
                  strokeMiterlimit: 4,
                  fillRule: 'nonzero',
                  fill: 'rgb(251, 204, 136)',
                }}
                animation={slideFromRight}
                delay={0.1}
              />
            </g>
          </g>
        </g>
      </svg>
    </LogoContainer>
  )
}
