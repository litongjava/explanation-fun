export default function Footer() {
  return (
    <footer style={{
      textAlign: 'center',
      padding: '1rem',
      backgroundColor: '#f8fafc',
      borderTop: '1px solid #e2e8f0',
      fontSize: '0.9rem',
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', gap: '1.5rem' }}>
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#2563eb',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center'
          }}
          className="footer-link"
        >
          京ICP备18010032号-3
        </a>
        <a
          href="https://edu.shipzz.com/#contact"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#2563eb',
            textDecoration: 'none',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center'
          }}
          className="footer-link"
        >
          关于我们
        </a>
      </div>
    </footer>
  );
}