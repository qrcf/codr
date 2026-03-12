import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleDialogProps {
  title: string
  icon?: React.ReactNode
  variant: 'permission' | 'plan' | 'question' | 'plan-review'
  children: React.ReactNode
  defaultCollapsed?: boolean
}

export function CollapsibleDialog({ title, icon, variant, children, defaultCollapsed = false }: CollapsibleDialogProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className={`collapsible-dialog collapsible-dialog--${variant}`}>
      <button className="collapsible-dialog-toggle" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {icon}
        <span className="collapsible-dialog-title">{title}</span>
      </button>
      <div className={`collapsible-dialog-body${collapsed ? ' collapsed' : ''}`}>
        {children}
      </div>
    </div>
  )
}
