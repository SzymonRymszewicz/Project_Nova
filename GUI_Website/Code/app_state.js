const navItems = document.querySelectorAll('.nav-item');
const messagesContainer = document.getElementById('messages');
const inputArea = document.getElementById('inputArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatHeader = document.getElementById('chatHeader');
const themeStylesheet = document.getElementById('themeStylesheet');
let currentView = 'last-chat';
let currentBotName = null;
let currentBotInfo = null;
let currentPersonaInfo = null;
let currentChatId = null;
let currentChatMessages = [];
let lastSavedTheme = 'default';
let lastSavedSettings = {};
let settingsDraft = {};

function buildImageStyle(url, fit) {
	if (!url) {
		return '';
	}
	const size = fit && Number.isFinite(fit.size) ? fit.size : 100;
	const x = fit && Number.isFinite(fit.x) ? fit.x : 50;
	const y = fit && Number.isFinite(fit.y) ? fit.y : 50;
	return `background-image:url('${url}');background-size:${size}%;background-position:${x}% ${y}%;background-repeat:no-repeat;`;
}
