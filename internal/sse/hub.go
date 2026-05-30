// Package sse implements a minimal Server-Sent Events hub: clients subscribe,
// receive the current snapshot on connect, and get a nudge whenever the data
// changes. The actual payload is fetched by the handler from the store.
package sse

import "sync"

// Hub tracks connected clients and fans out change notifications.
type Hub struct {
	mu      sync.Mutex
	clients map[chan struct{}]struct{}
}

// New creates an empty Hub.
func New() *Hub {
	return &Hub{clients: map[chan struct{}]struct{}{}}
}

// Subscribe registers a client and returns its notification channel + an
// unsubscribe func. The channel is buffered and coalescing.
func (h *Hub) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		if _, ok := h.clients[ch]; ok {
			delete(h.clients, ch)
			close(ch)
		}
		h.mu.Unlock()
	}
}

// Broadcast nudges every connected client (non-blocking; coalesces).
func (h *Hub) Broadcast() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- struct{}{}:
		default: // a nudge is already pending
		}
	}
}

// Count returns the number of connected clients (for diagnostics/tests).
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}
