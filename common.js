'use strict';

{
	const events = require('./events');

	const assert = (cond, msg) => {
		if (!cond) throw new Error(msg);
	};

	class MfMenu extends events {
		constructor ({document, menu}, {userState}) {
			super();

			this._dom = {document, menu};
			this._dependencies = {userState};

			this._menuPath = '/wiki/MediaWiki:Sidebar?action=raw';
			this._anchorBaseUrl = 'https://www.psychonautwiki.org'

			this._menu = {};

			this._menuUserLinks = [
				['Watchlist', 'Special:Watchlist', ['mw-ui-icon-watchlist']],
				['Upload', 'Special:Uploads', ['mw-ui-icon-uploads', 'menu-item-upload']],
				['Settings', 'Special:MobileOptions', ['mw-ui-icon-mobileoptions']]
			];

			/* failover */
			this._retryCount = 0;
			this._retryMax = 3;
		}

		_genericXhr (method, path, data, isJson, cb) {
			const xhr = new XMLHttpRequest();

			xhr.open(method, path, true);

			if (isJson) {
				xhr.setRequestHeader('Content-type', 'application/json');
			}

			xhr.onreadystatechange = function() {
				if (xhr.readyState !== 4) return;

				if (!isJson) {
					return cb(xhr.status >= 400, this.responseText);
				}

				let response;

				try {
					response = JSON.parse(this.responseText);
				} catch(err) {
					return cb(err);
				}

				cb(xhr.status >= 400, response);
			}

			xhr.send(data);
		}

		_setupBus () {
			this.on('sidebar', ({err, data}) => {
				try {
					this._processMenu({err, data});
				} catch(parseError) {
					/* gracefully handle parser errors */
					this._ingestError(parseError);
				}
			});
		}

		_ingestError (err) {
			if ('Raven' in window && 'captureException' in Raven) {
				/* send to sentry */
				Raven.captureException(err);
			}
		}

		_handleError (err) {
			this._ingestError(err);

			if (this._retryCount >= this._retryMax) {
				const retryOverflow = new Error('Could not load sidebar.');

				return this._ingestError(retryOverflow);
			}

			/* make sure we get off the stack */
			setTimeout(() => this._retrieveSidebar(), 0);
		}

		_parseMenu (data) {
			const menuLines = data
				/* extract lines */
				.split('\n')
				/* remove empty lines */
				.filter(x => x)
				/* process lines */
				.map(line => [
					/* get level by stars */
					line.match(/\*+/)[0].length,

					/* get line payload */
					line.match(/\*+(.*?)$/)[1]
				]);

			return menuLines.reduce((acc, curr) => {
				if (curr[0] === 1) {
					++acc.i;

					acc.sections.push([curr[1], []]);
				} else {
					acc.sections[acc.i][1].push(curr[1]);
				}

				return acc;
			}, {i: -1, sections: []});
		}

		_$createElement (...args) {
			return this._dom.document.createElement(...args);
		}

		_$wrapElement (tle, element) {
			const wrapper = this._$createElement(tle);

			wrapper.appendChild(element);

			return wrapper;
		}

		_$menuLinkItem (title, anchorLink, anchorClasses) {
			const anchor = this._$createElement('a');

			anchor.href = `${this._anchorBaseUrl}/wiki/${anchorLink}`;
			anchor.innerText = title;

			anchor.classList.add('mw-ui-icon', 'mw-ui-icon-before');
			anchor.classList.add(...anchorClasses);

			return this._$wrapElement('li', anchor);
		}

		_renderSection (section) {
			const navLabel = this._$createElement('h3');

			navLabel.innerText = section[0];

			const subsections = [
				this._$wrapElement('li', navLabel),

				...section[1].map(item => {
					const [anchorLink, title] = item.split('|');

					const iconClassSuffix = title.replace(/\s+/ig, '-');
					const anchorClass = `icon-${iconClassSuffix}`;

					return this._$menuLinkItem(title, anchorLink, [anchorClass]);
				})
			];

			const container = this._$createElement('ul');

			subsections.forEach(subsection =>
				container.appendChild(subsection)
			);

			return container;
		}

		_renderUserSections () {
			if (!this._dependencies.userState.isLoggedIn()) {
				return [];
			}

			return this._menuUserLinks.map((...args) =>
				this._$menuLinkItem(...args)
			);
		}

		_renderMenu (sections) {
			const renderedSections = sections.map(section =>
				this._renderSection(section)
			);

			const container = this._dom.document.createElement('div');

			container.classList.add('menu', 'view-border-box');

			const userSections = this._renderUserSections();

			[
				...renderedSections,
				...userSections
			].forEach(renderedSection =>
				container.appendChild(renderedSection)
			);

			return container;
		}

		_processMenu ({err, data}) {
			if (err) {
				return this._handleError(err);
			}

			assert(data, 'Data is not trueish');
			assert(data.constructor === String, 'Data is 	not a string');

			const {sections} = this._parseMenu(data);

			const renderedMenuSections = this._renderMenu(sections);

			const _menu = this._dom.menu;
			const _menuParent = _menu.parentNode;

			_menuParent.removeChild(_menu);
			_menuParent.appendChild(renderedMenuSections);

			return /* bail */;
		}

		_retrieveSidebar () {
			++this._retryCount;

			this._genericXhr('GET', this._menuPath, null, false, (err, data) =>
				this.emit('sidebar', {err, data})
			);
		}

		_setup () {
			this._setupBus();
			this._retrieveSidebar();
		}

		static initialize ({dom, userState}) {
			const mfMenu = new MfMenu(dom, {userState});

			mfMenu._setup();

			return mfMenu;
		}
	}

	class UserState {
		constructor() {
			this._userName = null;

			this._populateUser();
		}

		_populateUser () {
			if ('mw' in window && 'config' in window.mw) {
				this._userName = mw.config.values.wgUserName;
			}
		}

		getUsername () {
			return this._userName;
		}

		isLoggedIn () {
			return this._userName !== null;
		}
	}

	const menu = document.querySelector('.navigation-drawer .menu');
	const userState = new UserState;

	MfMenu.initialize({
		dom: {document, menu}, userState
	});
};