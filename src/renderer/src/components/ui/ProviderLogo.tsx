import { PROVIDER_THEME } from '../../provider-config'

interface ProviderLogoProps {
  providerId: string
  size?: number
  className?: string
  tint?: string // CSS color — renders logo in this color via mask-image
}

export function ProviderLogo({ providerId, size = 16, className = '', tint }: ProviderLogoProps) {
  const theme = PROVIDER_THEME[providerId as keyof typeof PROVIDER_THEME]
  if (!theme) return null

  if (tint) {
    return (
      <span
        className={`inline-block shrink-0 ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: tint,
          WebkitMaskImage: `url(${theme.logo})`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskImage: `url(${theme.logo})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
        }}
      />
    )
  }

  return (
    <img
      src={theme.logo}
      alt={theme.label}
      width={size}
      height={size}
      draggable={false}
      className={`inline-block object-contain shrink-0 ${className}`}
    />
  )
}
