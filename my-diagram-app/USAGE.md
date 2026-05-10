# My Diagram App - 使用方法 (USAGE)

このドキュメントでは、`My Diagram App` をローカル環境でセットアップし、実行するための手順を詳細に説明します。
リアルタイム共同編集機能と、AIアシスタント連携（MCPサーバー）を利用するために、複数のプロセスを起動する必要があります。

## 1. 前提条件

- **Node.js**: v18.x 以上を推奨
- **npm**: Node.js に付属
- **Git**: プロジェクトのクローンに必要
- **AIアシスタント**: Claude Desktop など、Model Context Protocol (MCP) に対応したAIクライアント

## 1.1 Node.js のインストール

[Node.js 公式サイト](https://nodejs.org/) から LTS 版をダウンロードしてインストールしてください。

インストール後、以下のコマンドでバージョンを確認します。

```bash
node -v
npm -v
```

`v18.x` 以上が表示されれば準備完了です。

## 2. プロジェクトのセットアップ

### 2.1 プロジェクトの取得

まず、このリポジトリをローカルにクローンまたはダウンロードします。

```bash
# Gitを使用する場合
git clone <リポジトリのURL> my-diagram-app
cd my-diagram-app
```

### 2.2 依存関係のインストール

社内ネットワーク等でプロキシを使用している場合は、先にnpmにプロキシを設定してください。

```bash
npm config set proxy http://proxy-server:8080/
npm config set https-proxy http://proxy-server:8080/
```

> プロキシが不要な環境ではこの手順はスキップしてください。

プロジェクトのルートディレクトリで、必要な依存関係をインストールします。

```bash
# プロジェクトのルートディレクトリ (my-diagram-app) で実行
npm install
```

次に、MCPサーバーの依存関係をインストールします。

```bash
# mcp-server ディレクトリに移動
cd mcp-server
npm install

# ルートディレクトリに戻る
cd ..
```

## 3. アプリケーションの実行

AI連携機能を含め、すべての機能を動作させるには、以下のいずれかの方法でプロセスを起動します。

### 3.1 まとめて起動する方法（推奨）

プロジェクトには、3つのサーバーを同時に立ち上げるための便利なスクリプトが用意されています。

```bash
# プロジェクトのルートディレクトリ (my-diagram-app) で実行
npm run start:all
```

このコマンドを実行すると、`concurrently` によって以下の 3 つが並列に起動し、ログが色分けされて一つのターミナルに表示されます。

> **トラブルシューティング**: 
> もし `'cross-env' は、内部コマンドまたは外部コマンド...` というエラーが発生した場合は、依存関係が未インストールです。
> プロジェクトのルートディレクトリで `npm install` を実行してください。
> ※ 最新の `package.json` では `cross-env` を使用しない設定に改善されています。

### 3.2 個別に起動する場合

各プロセスを別々のターミナルで起動して詳細なログを確認したい場合は、以下の手順で行います。

#### 3.2.1 ターミナル1: Yjs 同期サーバーの起動

ブラウザ上のアプリと、AI連携用の `MCPサーバー` の間で、図面データをリアルタイムに同期するための WebSocket サーバーです。

```bash
# プロジェクトのルートディレクトリ (my-diagram-app) で実行
npx y-websocket
```

*   **ポート**: 1234 (デフォルト)
*   このプロセスは、`ws://localhost:1234` で接続を待ち受けます。

#### 3.2.2 ターミナル2: フロントエンド（Reactアプリ）の起動

図面を表示し、操作するための Web アプリケーションです。

```bash
# プロジェクトのルートディレクトリ (my-diagram-app) で実行
npm run dev
```

*   **URL**: `http://<サーバーのIPアドレス>:5173/`
*   起動後、ブラウザで上記の URL を開いてください。

#### 3.2.3 ターミナル3: MCPサーバーの起動

AIアシスタントからの命令（図面の読み取りやノード追加）を受け取り、データを操作するサーバーです。

```bash
# mcp-server ディレクトリに移動して実行
cd mcp-server
node index.js
```

*   **ポート**: 3000
*   このプロセスは、すべてのネットワークインターフェース (`http://0.0.0.0:3000/sse`) で接続を待ち受けます。

## 4. AIアシスタント（Claude Desktopなど）の設定

AIアシスタントが MCP サーバーを認識できるように、設定ファイルを編集します。

### 4.1 Claude Desktop の設定

設定ファイル（`claude_desktop_config.json`）を編集します。

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

以下の内容を `mcpServers` セクションに追記または更新します。

```json
{
  "mcpServers": {
    "diagram-app": {
      "url": "http://localhost:3000/sse" 
    }
  }
}
```

**重要**: 設定ファイルを保存した後、**Claude Desktop を必ず再起動**してください。

## 5. 動作確認

1.  すべてのターミナルプロセスが正常に起動していることを確認します。
2.  ブラウザでアプリを開きます。
3.  Claude Desktop を開き、右下のハンマーアイコンから `diagram-app` が認識されていることを確認します。
4.  AI に「現在の図面の内容を教えて」と指示し、現在のノード一覧が表示されれば成功です。