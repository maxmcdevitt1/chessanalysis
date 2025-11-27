// webui/src/TagBadges.tsx — uses local PNG assets for Good (!) and Blunder (??)
import React from 'react';
import goodPng from './assets/good.png';
import blunderPng from './assets/blunder.png';

type BadgeProps = { size?: number | string };

const ImgBadge: React.FC<{ src: string; size?: number | string; alt: string }> = ({ src, size = 44, alt }) => (
  <img src={src} alt={alt} width={typeof size === 'number' ? size : undefined} height={typeof size === 'number' ? size : undefined} style={{ width: size, height: size, display: 'block' }} />
);

// GOOD (!) — provided PNG
export const GoodBadge = ({ size = 44 }: BadgeProps) => (
  <ImgBadge src={goodPng} size={size} alt="Good move" />
);

// BLUNDER (??) — provided PNG
export const BlunderBadge = ({ size = 44 }: BadgeProps) => (
  <ImgBadge src={blunderPng} size={size} alt="Blunder" />
);

// The rest remain SVG for lightness
const Svg = ({ size = 44, children }: React.PropsWithChildren<BadgeProps>) => (
  <svg width={size as number} height={size as number} viewBox="0 0 48 48" fill="none" role="img" aria-hidden="true">
    {children}
  </svg>
);

const Disk: React.FC<{fill:string}> = ({ fill }) => (
  <g>
    <circle cx={24} cy={24} r={21} fill={fill} />
    <circle cx={24} cy={24} r={21} fill="none" stroke="#e5e7eb" strokeWidth={2}/>
  </g>
);

// BRILLIANT (!!)
export const BrilliantBadge = ({ size=44 }: BadgeProps) => (
  <Svg size={size}>
    <Disk fill="#14b8a6"/>
    <path d="M18 12 v18 M18 33 v2" stroke="white" strokeWidth="5" strokeLinecap="round"/>
    <path d="M30 12 v18 M30 33 v2" stroke="white" strokeWidth="5" strokeLinecap="round"/>
  </Svg>
);

// BEST (star)
export const BestBadge = ({ size=44 }: BadgeProps) => (
  <Svg size={size}>
    <Disk fill="#84cc16"/>
    <path d="M24 11l3.9 7.9 8.7 1.2-6.3 6.1 1.4 8.8L24 31.8l-7.7 3.2 1.4-8.8-6.3-6.1 8.7-1.2L24 11z"
      fill="white" stroke="white" strokeLinejoin="round"/>
  </Svg>
);

// BOOK
export const BookBadge = ({ size=44 }: BadgeProps) => (
  <Svg size={size}>
    <Disk fill="#a78b65"/>
    <path d="M14 16h10a4 4 0 0 1 4 4v12H18a4 4 0 0 0-4-4V16z" fill="white" />
    <path d="M24 16h10a4 4 0 0 1 4 4v12H28a4 4 0 0 0-4-4V16z" fill="white" />
    <path d="M24 16v16" stroke="#a78b65" strokeWidth="2"/>
  </Svg>
);

// MISTAKE (?)
export const MistakeBadge = ({ size=44 }: BadgeProps) => (
  <Svg size={size}>
    <Disk fill="#f59e0b"/>
    <path d="M20 18c0-3 2.6-5 5.2-5 2.6 0 4.6 1.4 4.6 3.6 0 3.4-3.6 3.5-3.6 6.8" stroke="white" strokeWidth="3.4" strokeLinecap="round" fill="none"/>
    <circle cx={26} cy={34} r={2.4} fill="white"/>
  </Svg>
);
