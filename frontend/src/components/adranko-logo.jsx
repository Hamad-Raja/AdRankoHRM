import { useId } from 'react';

export default function AdRankoLogo() {
  const backgroundFilter = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="size-7 shrink-0"
      viewBox="18 14 108 96"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={backgroundFilter} x="0" y="0" width="168" height="114" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          {/* Keep the supplied pixels and blue mark; make its white background transparent. */}
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1.25 0 0 0 1.25" />
        </filter>
      </defs>
      <image href="/adranko-logo.png" width="168" height="114" filter={`url(#${backgroundFilter})`} />
    </svg>
  );
}
