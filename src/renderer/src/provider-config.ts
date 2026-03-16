import type { AgentProviderId } from '../../shared/provider-types'
import claudeLogo from '../../../public/logos/claude-white.png'
import cursorLogo from '../../../public/logos/cursor-white.png'

export interface ProviderTheme {
  label: string
  logo: string
  // Sidebar "New Chat" button
  buttonBg: string
  buttonHover: string
  buttonText: string
  // SettingsPanel card
  cardBg: string
  cardText: string
  badgeActive: string
  badgeInactive: string
}

export const PROVIDER_THEME: Record<AgentProviderId, ProviderTheme> = {
  claude: {
    label: 'Claude',
    logo: claudeLogo,
    buttonBg: 'bg-[#DE7356]',
    buttonHover: 'hover:bg-[#c96248]',
    buttonText: 'text-white',
    cardBg: 'bg-[rgba(222,115,86,0.12)]',
    cardText: 'text-[#e8a08a]',
    badgeActive: 'bg-[#3d2520] text-[#e8a08a]',
    badgeInactive: 'bg-[#2d2525] text-[#c08060]',
  },
  cursor: {
    label: 'Cursor',
    logo: cursorLogo,
    buttonBg: 'bg-[#14120b]',
    buttonHover: 'hover:bg-[#1e1c14]',
    buttonText: 'text-white',
    cardBg: 'bg-[rgba(20,18,11,0.3)]',
    cardText: 'text-[#e0e0e0]',
    badgeActive: 'bg-[#1e1c14] text-[#e0e0e0]',
    badgeInactive: 'bg-[#1a1a18] text-[#999]',
  },
}
