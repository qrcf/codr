export default function Footer() {
  return (
    <footer className="mk-footer">
      <div className="mk-container mk-footer__trial">
        This service is provided as a free trial by Artificial Enterprises, LLC and may be revoked at any time without notice.
      </div>
      <div className="mk-container mk-footer__inner">
        <div className="mk-footer__brand">
          <span className="mk-footer__logo">
            <img src="/codr-logo-transparent.png" alt="Codr" className="mk-footer__logo-img" />
            Codr
          </span>
          <span className="mk-footer__copy">
            &copy; {new Date().getFullYear()} Artificial Enterprises, LLC. All rights reserved.
          </span>
        </div>
        <div className="mk-footer__links">
          <a href="/app" className="mk-footer__link">Sign In</a>
          <a href="#features" className="mk-footer__link">Features</a>
          <a href="#download" className="mk-footer__link">Download</a>
          <a href="/privacy" className="mk-footer__link">Privacy Policy</a>
          <a href="/terms" className="mk-footer__link">Terms of Service</a>
        </div>
      </div>
    </footer>
  )
}
