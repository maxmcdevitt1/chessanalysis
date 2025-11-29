// webui/src/icons.tsx
import React from 'react';

export type IconProps = React.SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };

function Svg({ size = 18, strokeWidth = 1.8, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H20v16H5.5A2.5 2.5 0 0 0 3 21z" />
    <path d="M20 3v16" />
    <path d="M3 5.5V21" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14 18.18 21 12 17.77 5.82 21 7 14 2 9.27 8.91 8.26 12 2" />
  </Svg>
);

export const ThumbUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 9V5a3 3 0 0 0-3-3l-1 6" />
    <path d="M7 11h10a2 2 0 0 1 2 2l-1 6a2 2 0 0 1-2 2H9a4 4 0 0 1-4-4v-4a2 2 0 0 1 2-2z" />
  </Svg>
);

export const AlertTriangleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12" y2="17" />
  </Svg>
);

export const OctagonXIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" />
    <path d="M15 9 9 15M9 9l6 6" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4" />
    <path d="M8 8l4-4 4 4" />
    <path d="M20 20H4" />
  </Svg>
);

export const SparklesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" transform="translate(7 1) scale(.6)" />
    <path d="M12 2l1.2 2.4L16 5.6l-2.8 1.2L12 9l-1.2-2.2L8 5.6l2.8-1.2z" transform="translate(-2 8) scale(.8)" />
  </Svg>
);

export const BotIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="7" width="14" height="10" rx="2" />
    <path d="M12 2v3" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <path d="M8 17h8" />
  </Svg>
);

export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11v-2a6 6 0 0 1 6-6h12" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a6 6 0 0 1-6 6H3" />
  </Svg>
);

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}><path d="M15 18 9 12l6-6" /></Svg>
);
export const ChevronRight = (p: IconProps) => (
  <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>
);
export const ChevronsLeft = (p: IconProps) => (
  <Svg {...p}><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></Svg>
);
export const ChevronsRight = (p: IconProps) => (
  <Svg {...p}><path d="M13 7l5 5-5 5"/><path d="M6 7l5 5-5 5"/></Svg>
);
