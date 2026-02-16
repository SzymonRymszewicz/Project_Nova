function showView(view) {
	const previousView = currentView;
	currentView = view;
	const appRoot = document.querySelector('.app');
	const botPanel = document.getElementById('botPanel');
	if (botPanel) {
		botPanel.classList.toggle('visible', view === 'last-chat');
		if (view === 'last-chat') {
			updateBotPanel();
		}
	}
	if (appRoot) {
		appRoot.classList.toggle('chat-layout', view === 'last-chat');
	}
	if (previousView === 'settings' && view !== 'settings') {
		revertUnsavedSettings();
	}
	messagesContainer.innerHTML = '';
	if (view === 'last-chat') {
		showLastChat();
	} else if (view === 'bots') {
		showBots();
	} else if (view === 'bot-create') {
		showBotCreation();
	} else if (view === 'chats') {
		showChats();
	} else if (view === 'personas') {
		showPersonas();
	} else if (view === 'settings') {
		showSettings();
	}
}

function switchToLastChat() {
	navItems[0].click();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});
messageInput.addEventListener('input', autoResizeMessageInput);
navItems.forEach(item => {
	item.addEventListener('click', () => {
		navItems.forEach(i => i.classList.remove('active'));
		item.classList.add('active');
		showView(item.dataset.view);
	});
});

resetMessageInputHeight();
showView('last-chat');
initSettings();
