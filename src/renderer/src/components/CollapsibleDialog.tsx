import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleDialogProps {
  title: string
  icon?: React.ReactNode
  variant: 'permission' | 'plan' | 'question' | 'plan-review'
  children: React.ReactNode
  defaultCollapsed?: boolean
}

const variantStyles = {
  permission: { border: 'border-2 border-[#8142c7]', bg: 'bg-[#1e1e2a]', toggleColor: 'text-[#a0b0ff]' },
  plan: { border: 'border-2 border-[#8142c7]', bg: 'bg-[#1e1e2e]', toggleColor: 'text-[#a0b0ff]' },
  question: { border: 'border-2 border-[#8142c7]', bg: 'bg-[#1a1a2a]', toggleColor: 'text-[#8142c7]' },
  'plan-review': { border: 'border border-[#4a4a3a]', bg: 'bg-[#1e1e1a]', toggleColor: 'text-[#c0a878]' },
}

export function CollapsibleDialog({ title, icon, variant, children, defaultCollapsed = false }: CollapsibleDialogProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const vs = variantStyles[variant]
  const hasScrollBody = variant === 'permission' || variant === 'plan'

  return (
    <div className={`rounded-lg overflow-hidden ${vs.border} ${vs.bg}`}>
      <button
        className={`flex items-center gap-2 w-full px-[14px] py-2 border-none bg-transparent cursor-pointer font-semibold text-[0.9em] transition-colors hover:bg-white/5 ${vs.toggleColor}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {icon}
        <span>{title}</span>
      </button>
      <div className={`collapsible-body${collapsed ? ' collapsed' : ''}${hasScrollBody ? ' flex flex-col max-h-[calc(70vh-50px)] overflow-hidden' : ''}`}>
        {children}
      </div>
    </div>
  )
}
