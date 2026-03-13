import { useUser } from '@clerk/clerk-react'
import { Settings } from 'lucide-react'
import { RemotePanel } from './RemotePanel'

interface SidebarProfileProps {
  user: ReturnType<typeof useUser>['user']
  accountError: string | null
  onOpenSettings?: () => void
}

export function SidebarProfile({ user, accountError, onOpenSettings }: SidebarProfileProps) {
  return (
    <div className="flex items-center gap-2.5">
      {user?.imageUrl && (
        <img
          className="w-[32px] h-[32px] rounded-full object-cover shrink-0 border border-[#333]"
          src={user.imageUrl}
          alt={user.fullName || 'User avatar'}
          referrerPolicy="no-referrer"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[#ddd] text-[0.9em] font-medium overflow-hidden text-ellipsis whitespace-nowrap leading-tight">
          {user?.fullName || (
            <span className="text-[#666] italic" title={accountError || undefined}>
              {accountError ? 'Auth failed' : 'Checking auth...'}
            </span>
          )}
        </div>
        {user?.primaryEmailAddress?.emailAddress && (
          <div className="text-[#666] text-[0.75em] overflow-hidden text-ellipsis whitespace-nowrap leading-tight mt-[1px]">
            {user.primaryEmailAddress.emailAddress}
          </div>
        )}
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
