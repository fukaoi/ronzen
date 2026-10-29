/**
 * API client for the LLM Council backend.
 */

/**
 * Where the API lives.
 *
 * In a production build the backend serves this page too, so an empty base
 * keeps every request on the page's own origin - which is what lets the
 * Cloudflare Access session cookie ride along. During `npm run dev` the page
 * comes from Vite instead, so it has to reach across to the backend port.
 * VITE_API_BASE overrides both.
 */
const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? 'http://localhost:8001' : '');

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Upload attachments as base64 data URLs.
   * @param {Array<{data_url: string, name: string}>} files
   * @returns {Promise<Array<{filename: string, name: string, kind: string, size: number, url: string}>>}
   */
  async uploadFiles(files) {
    const response = await fetch(`${API_BASE}/api/uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || 'Failed to upload images');
    }
    return response.json();
  },

  /**
   * Build the URL for an uploaded attachment.
   * @param {string} filename - Filename returned by uploadFiles
   */
  fileUrl(filename) {
    return `${API_BASE}/api/uploads/${filename}`;
  },

  /**
   * Send a message in a conversation.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {string[]} images - Filenames of uploaded images to attach
   * @param {string[]} files - Filenames of uploaded text files to attach
   */
  async sendMessage(conversationId, content, images = [], files = []) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, images, files }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {string[]} images - Filenames of uploaded images to attach
   * @param {string[]} files - Filenames of uploaded text files to attach
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, images, files, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          images: images || [],
          files: files || [],
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // A network chunk is not an SSE event: it can split a multi-byte
    // character, carry half an event, or carry several. Decode in streaming
    // mode and only hand over whole events, separated by a blank line.
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data: ')) continue;

          let event;
          try {
            event = JSON.parse(line.slice(6));
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
            continue;
          }

          // Deliberately outside the try above: a bug in the handler is not
          // a parse failure, and swallowing it here would strand the caller
          onEvent(event.type, event);
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  },
};
