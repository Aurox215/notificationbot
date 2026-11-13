import { extractProjects } from './extractor.js';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id === chrome.runtime.id && message?.type === 'SCAN_PAGE') {
    reply(extractProjects(document, location.href));
  }
});
