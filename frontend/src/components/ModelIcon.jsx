import { providerOf } from '../models';
import './ModelIcon.css';

export default function ModelIcon({ model, size = 18, raised = false }) {
  const provider = providerOf(model);
  const style = { '--icon-size': `${size}px` };

  return (
    <span
      className={`model-icon ${raised ? 'raised' : ''}`}
      style={style}
      title={`${provider.name} · ${model}`}
    >
      {provider.mono ? (
        <span
          className="model-icon-mask"
          style={{
            backgroundColor: provider.color,
            maskImage: `url("${provider.src}")`,
            WebkitMaskImage: `url("${provider.src}")`,
          }}
        />
      ) : (
        <img className="model-icon-img" src={provider.src} alt={provider.name} />
      )}
    </span>
  );
}
