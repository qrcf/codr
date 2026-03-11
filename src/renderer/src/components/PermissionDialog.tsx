import { formatValue } from './JsonHighlight'

export function PermissionDialog({ request, onRespond }: {
  request: PermissionRequest
  onRespond: (id: number, allowed: boolean) => void
}) {
  return (
    <div className="permission-dialog">
      <div className="permission-header">
        <span className="permission-icon">!</span>
        Permission Required
      </div>
      <div className="permission-body">
        <span className="tool-name-badge">{request.tool}</span>
        {formatValue(request.input)}
      </div>
      <div className="permission-actions">
        <button className="btn btn-deny" onClick={() => onRespond(request.id, false)}>Deny</button>
        <button className="btn btn-approve" onClick={() => onRespond(request.id, true)}>Approve</button>
      </div>
    </div>
  )
}
