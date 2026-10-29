import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?url';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import grok from '@lobehub/icons-static-svg/icons/grok.svg?url';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?url';
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg?url';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?url';
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url';
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg?url';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg?url';

/**
 * Provider logos, keyed by the vendor prefix of an OpenRouter model id.
 *
 * `mono` icons are single-colour SVGs (fill="currentColor"), which an <img>
 * would always paint black, so they are drawn as a CSS mask in `color` instead.
 */
const PROVIDERS = {
  openai: { name: 'OpenAI', src: openai, mono: true, color: '#0d0d0d' },
  anthropic: { name: 'Anthropic', src: claude },
  google: { name: 'Google', src: gemini },
  qwen: { name: 'Qwen', src: qwen },
  deepseek: { name: 'DeepSeek', src: deepseek },
  'x-ai': { name: 'xAI', src: grok, mono: true, color: '#0d0d0d' },
  mistralai: { name: 'Mistral', src: mistral },
  'meta-llama': { name: 'Meta', src: meta },
  moonshotai: { name: 'Moonshot', src: kimi },
  'z-ai': { name: 'Zhipu', src: zhipu },
  minimax: { name: 'MiniMax', src: minimax },
  cohere: { name: 'Cohere', src: cohere },
  perplexity: { name: 'Perplexity', src: perplexity },
  nvidia: { name: 'NVIDIA', src: nvidia },
};

const FALLBACK = { name: 'OpenRouter', src: openrouter, mono: true, color: '#6d5cf0' };

/**
 * Look up the provider of a model id such as "anthropic/claude-opus-5.5".
 * OpenRouter's "~vendor/model-latest" aliases carry a leading tilde.
 */
export function providerOf(model = '') {
  const vendor = model.replace(/^~/, '').split('/')[0].toLowerCase();
  return PROVIDERS[vendor] || FALLBACK;
}

/**
 * The part of a model id after the vendor, for compact labels.
 */
export function shortName(model = '') {
  return model.split('/')[1] || model;
}
