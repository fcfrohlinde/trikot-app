import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('Trikot-App Crash:', error, info);
  }
  reset = () => {
    this.setState({ error: null, info: null });
    if (this.props.onReset) this.props.onReset();
  };
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', padding: 24, background: '#F8F5F0', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 720, margin: '40px auto', background: 'white', padding: 32, border: '2px solid #9A2828' }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.18em', fontSize: 12, color: '#9A2828' }}>FEHLER</div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 32, margin: '8px 0 16px', color: '#1A1A1A' }}>
              Etwas ist schiefgelaufen
            </h1>
            <p style={{ color: '#4A4845', fontSize: 14, marginBottom: 16 }}>
              Bei der Anzeige dieser Seite ist ein Fehler aufgetreten. Hier sind die Details — du kannst sie kopieren und Dirk schicken, dann lässt sich das Problem schnell beheben.
            </p>
            <div style={{ background: '#F5E6E6', padding: 12, fontSize: 12, fontFamily: 'monospace', color: '#9A2828', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
              <strong>{this.state.error.toString()}</strong>
              {this.state.info?.componentStack && (
                <div style={{ marginTop: 8, color: '#4A4845' }}>{this.state.info.componentStack}</div>
              )}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button onClick={this.reset} style={{ padding: '10px 20px', background: '#0B2D5C', color: 'white', border: 'none', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em', fontSize: 12, cursor: 'pointer' }}>
                Zurück zur Übersicht
              </button>
              <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: 'white', color: '#1A1A1A', border: '1px solid #DCD6C8', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em', fontSize: 12, cursor: 'pointer' }}>
                Seite neu laden
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
