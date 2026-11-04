import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from './MermaidDiagram';

const PLUGINS = [remarkGfm];

function isMermaid(codeElement) {
  return /\blanguage-mermaid\b/.test(codeElement?.props?.className || '');
}

const COMPONENTS = {
  // A fenced ```mermaid block is drawn as a diagram; any other code stays as it was
  pre({ children }) {
    const code = Array.isArray(children) ? children[0] : children;
    if (isMermaid(code)) {
      return <MermaidDiagram source={String(code.props.children).replace(/\n$/, '')} />;
    }
    return <pre>{children}</pre>;
  },
};

/** Markdown as the app shows it: tables, and diagrams written in Mermaid. */
export default function Markdown({ children }) {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
