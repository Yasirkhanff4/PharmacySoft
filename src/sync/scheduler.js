let handler = null;

export function setSyncRequestHandler(nextHandler) {
  handler = nextHandler;
}

export function requestSync(reason = "manual") {
  if (typeof handler === "function") {
    handler(reason);
  }
}
