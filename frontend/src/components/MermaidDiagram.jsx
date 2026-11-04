import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';

// Mermaid is large, so it is fetched the first time a diagram needs drawing,
// and set up once, in the colours of the rest of the page
let mermaidPromise;
let drawCount = 0;

function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: "'Noto Sans JP', 'Noto Sans SC', sans-serif",
      themeVariables: {
        background: '#f4eee0',
        primaryColor: '#ebe3d0',
        primaryTextColor: '#2b2622',
        primaryBorderColor: '#2f4f7a',
        secondaryColor: '#f4eee0',
        tertiaryColor: '#f4eee0',
        lineColor: '#6b6254',
        textColor: '#2b2622',
        edgeLabelBackground: '#f4eee0',
        noteBkgColor: '#f7ebc9',
        noteBorderColor: '#d9a21b',
      },
    });
    return mermaid;
  });
  return mermaidPromise;
}

/**
 * A diagram written in Mermaid, drawn. The source shows first and stays if the
 * diagram cannot be drawn; a switch gives the source back, ready to copy.
 */
export default function MermaidDiagram({ source }) {
  const { t } = useI18n();
  const [drawn, setDrawn] = useState({ status: 'drawing', svg: '' });
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;
    const id = `mermaid-diagram-${++drawCount}`;
    setDrawn({ status: 'drawing', svg: '' });

    loadMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg }) => {
        if (current) setDrawn({ status: 'ready', svg });
      })
      .catch(() => {
        // A failed render leaves its error picture behind in the page
        document.getElementById(`d${id}`)?.remove();
        if (current) setDrawn({ status: 'failed', svg: '' });
      });

    return () => {
      current = false;
    };
  }, [source]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the source is selectable on screen
    }
  };

  const ready = drawn.status === 'ready';

  return (
    <div className="mermaid-block">
      <div className="mermaid-toolbar">
        {ready && (
          <div className="mermaid-switch" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!showSource}
              className={!showSource ? 'active' : ''}
              onClick={() => setShowSource(false)}
            >
              {t('diagram.diagram')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={showSource}
              className={showSource ? 'active' : ''}
              onClick={() => setShowSource(true)}
            >
              {t('diagram.source')}
            </button>
          </div>
        )}
        <button type="button" className="mermaid-copy" onClick={copy}>
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>

      {ready && !showSource ? (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      ) : (
        <pre className="mermaid-source">
          <code>{source}</code>
        </pre>
      )}

      {drawn.status === 'failed' && <p className="mermaid-note">{t('diagram.failed')}</p>}
    </div>
  );
}
