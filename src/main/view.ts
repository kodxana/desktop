import { BrowserView, app, Menu, nativeImage, clipboard } from 'electron';
import { appWindow } from '.';
import { sendToAllExtensions } from './extensions';
import { resolve, join } from 'path';
import { icons } from '../renderer/app/constants';


export class View extends BrowserView {
  public title: string = '';
  public url: string = '';
  public tabId: number;
  public homeUrl: string;

  constructor(id: number, url: string) {
    super({
      webPreferences: {
        preload: `${app.getAppPath()}/build/view-preload.js`,
        nodeIntegration: false,
        additionalArguments: [`--tab-id=${id}`],
        contextIsolation: true,
        partition: 'persist:view',
      },
    });

    this.homeUrl = url;
    this.tabId = id;

    this.webContents.on('context-menu', (e, params) => {
      const menu = Menu.buildFromTemplate([
        {
          role: 'copy',
          label: 'Copy'
        },
        {
          role: 'paste',
          label: 'Paste'
        },
        {
          type: 'separator'
        },
        {
          id: 'screenshot',
          label: 'Screenshot',
          click: () => {
            this.webContents.capturePage(img => {
              clipboard.writeBuffer("image/png", img.toPNG())
            });
          }
        },
        {
          type: 'separator'
        },
        {
          id: 'inspect',
          label: 'Inspect',
          click: () => {
            this.webContents.inspectElement(params.x, params.y);

            if (this.webContents.isDevToolsOpened()) {
              this.webContents.devToolsWebContents.focus();
            }
          }
        },
      ]);

      menu.popup();
    });

    this.webContents.addListener('did-stop-loading', () => {
      this.updateNavigationState();
      appWindow.webContents.send(`view-loading-${this.tabId}`, false);
    });

    this.webContents.addListener('did-start-loading', () => {
      this.updateNavigationState();
      appWindow.webContents.send(`view-loading-${this.tabId}`, true);
    });

    this.webContents.addListener('did-start-navigation', () => {
      this.updateNavigationState();

      this.emitWebNavigationEvent('onBeforeNavigate', {
        tabId: this.tabId,
        url: this.webContents.getURL(),
        frameId: 0,
        timeStamp: Date.now(),
        processId: process.pid,
        parentFrameId: -1,
      });

      this.emitWebNavigationEvent('onCommitted', {
        tabId: this.tabId,
        url,
        sourceFrameId: 0,
        timeStamp: Date.now(),
        processId: process.pid,
        frameId: 0,
        parentFrameId: -1,
      });
    });

    this.webContents.addListener('did-finish-load', async () => {
      // This blocks annoying google popups
      let code = `document.getElementById("lb").style.display == 'none';`;
      this.webContents.executeJavaScript(code);
      this.emitWebNavigationEvent('onCompleted', {
        tabId: this.tabId,
        url: this.webContents.getURL(),
        frameId: 0,
        timeStamp: Date.now(),
        processId: process.pid,
      });

      appWindow.webContents.send(
        `new-screenshot-${this.tabId}`,
        await this.getScreenshot(),
      );
    });

    this.webContents.addListener('did-frame-finish-load', async () => {
      appWindow.webContents.send(
        `new-screenshot-${this.tabId}`,
        await this.getScreenshot(),
      );
    });

    this.webContents.addListener(
      'new-window',
      (e, url, frameName, disposition) => {
        if (disposition === 'new-window' || disposition === 'foreground-tab') {
          appWindow.webContents.send('api-tabs-create', { url, active: true });
        } else if (disposition === 'background-tab') {
          appWindow.webContents.send('api-tabs-create', { url, active: false });
        }

        this.emitWebNavigationEvent('onCreatedNavigationTarget', {
          tabId: this.tabId,
          url,
          sourceFrameId: 0,
          timeStamp: Date.now(),
        });
      },
    );

    this.webContents.addListener('dom-ready', () => {
      this.emitWebNavigationEvent('onDOMContentLoaded', {
        tabId: this.tabId,
        url: this.webContents.getURL(),
        frameId: 0,
        timeStamp: Date.now(),
        processId: process.pid,
      });
    });

    this.webContents.addListener(
      'page-favicon-updated',
      async (e, favicons) => {
        appWindow.webContents.send(
          `browserview-favicon-updated-${this.tabId}`,
          favicons[0],
        );
      },
    );

    this.webContents.addListener('did-change-theme-color', (e, color) => {
      appWindow.webContents.send(
        `browserview-theme-color-updated-${this.tabId}`,
        color,
      );
    });

    (this.webContents as any).addListener(
      'certificate-error',
      (
        event: Electron.Event,
        url: string,
        error: string,
        certificate: Electron.Certificate,
        callback: Function,
      ) => {
        console.log(certificate, error, url);
        // TODO: properly handle insecure websites.
        event.preventDefault();
        callback(true);
      },
    );

    this.setAutoResize({ width: true, height: true });
    console.log(url)
    if(url != "_self") {
      this.webContents.loadURL(url);
    }

    var hostname = "";
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("//") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    process.env.RP_TYPE = `Brow-${hostname}`
  }

  public updateNavigationState() {
    if (this.isDestroyed()) return;

    if (appWindow.viewManager.selectedId === this.tabId) {
      appWindow.webContents.send('update-navigation-state', {
        canGoBack: this.webContents.canGoBack(),
        canGoForward: this.webContents.canGoForward(),
      });
    }
  }

  public emitWebNavigationEvent = (name: string, ...data: any[]) => {
    this.webContents.send(`api-emit-event-webNavigation-${name}`, ...data);

    sendToAllExtensions(`api-emit-event-webNavigation-${name}`, ...data);
  };

  public async getScreenshot(): Promise<string> {
    return new Promise(resolve => {
      this.webContents.capturePage(img => {
        resolve(img.toDataURL());
      });
    });
  }
}