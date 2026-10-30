import { useState, useEffect } from 'react';
import { api } from '../api';
import './InstructionsDialog.css';

const MAX_CHARS = 4000;

const EXAMPLES = [
  'Keep answers simple, clear and short',
  'Do not be too strict with the rules',
];

export default function InstructionsDialog({ onClose }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getInstructions()
      .then((current) => {
        setText(current);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.saveInstructions(text);
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="instructions-overlay" onClick={onClose}>
      <div
        className="instructions-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Council Rules</h2>
        <p className="instructions-help">
          What you write here is given to every council model (Stages 1-3) as
          standing instructions with each question. Changes apply from the
          next question.
        </p>

        <textarea
          value={text}
          rows={8}
          maxLength={MAX_CHARS}
          disabled={!loaded}
          placeholder={EXAMPLES.map((e) => `・${e}`).join('\n')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="instructions-count">
          {text.length} / {MAX_CHARS}
        </div>

        {error && <div className="instructions-error">{error}</div>}

        <div className="instructions-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="instructions-primary"
            disabled={!loaded || saving}
            onClick={save}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
