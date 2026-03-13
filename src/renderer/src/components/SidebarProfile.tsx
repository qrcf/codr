import { Settings } from 'lucide-react'
import { RemotePanel } from './RemotePanel'

interface SidebarProfileProps {
  accountInfo: AccountInfo | null
  accountError: string | null
  onOpenSettings?: () => void
  userProfile?: { email: string | null; fullName: string | null; imageUrl: string | null } | null
}

export function SidebarProfile({ accountInfo, accountError, onOpenSettings, userProfile }: SidebarProfileProps) {
  const displayEmail = userProfile?.email || accountInfo?.email
  const displayName = userProfile?.fullName

  return (
    <div className="flex items-center gap-2.5">
      {userProfile?.imageUrl && (
        <img
          className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#333]"
          src={userProfile.imageUrl}
          alt={displayName || 'User avatar'}
          referrerPolicy="no-referrer"
        />
      )}
      <div className="flex-1 min-w-0">
        {displayName && (
          <div className="text-[#ddd] text-[0.9em] font-medium overflow-hidden text-ellipsis whitespace-nowrap leading-tight">
            {displayName}
          </div>
        )}
        <div className={`text-[#999] text-[0.8em] overflow-hidden text-ellipsis whitespace-nowrap ${displayName ? '' : 'text-[0.9em] text-[#ddd] font-medium leading-tight'}`}>
          {displayEmail || (
            <span className="text-[#666] italic" title={accountError || undefined}>
              {accountError ? 'Auth failed' : 'Checking auth...'}
            </span>
          )}
        </div>
        <div className="mt-[3px]">
          <RemotePanel />
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[#555] text-[0.65em] select-none">v{__APP_VERSION__}</span>
        <button
          className="bg-transparent border border-[#333] text-[#888] cursor-pointer text-[18px] w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-150 shrink-0 hover:text-[#ccc] hover:bg-[#2a2a3a] max-[768px]:w-10 max-[768px]:h-10"
          onClick={onOpenSettings}
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  )
}
