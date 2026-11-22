---
title: "AI.md"
description: "AI が Plumeria のコードを書くときに守るルールです。"
---

この資料は、Plumeria のコードを生成する AI アシスタント（Claude、Gemini、ChatGPT など）向けです。コードを書くときは、ここに示すルールと書き方を必ず使ってください。

`@plumeria/eslint-plugin` の推奨設定（`plumeria.configs.recommended`）を有効にし、警告はすべて直してください。

## 基本のルール

最初にルールを一覧にしました。それぞれの理由と例は後の節で説明します。

**必ず守ること**

- `css.create()` はモジュールのトップレベルで呼びます。コンポーネントの中で呼ぶとビルドできません。「使えない書き方」を参照してください。
- スタイルは `sx` で要素に付けます。`className` との違いは「仕組み」で説明します。
- 別ファイルから読み込んだスタイルを使うだけのファイルも含め、Plumeria のスタイルを使うファイルでは `@plumeria/core` を import します。`sx` 以外の prop で渡す場合は必須です。ほかの場合もこの書き方で動作し、コンパイラが最も速く対象を判別できます。
- 入れ子のセレクターのキーは、疑似クラス・疑似要素なら `:`、属性なら `[` から始めます。
- 同時に当てはまる二つの疑似クラスで同じプロパティを指定する場合は、両方に当てはまるセレクターも明示します。
- 複数のスタイルは配列で重ねます。同じプロパティは右側の値が優先されます。

**避けること**

- `sx={{ color: 'red' }}` のように、`sx` にオブジェクトを直接書くこと。
- コンポーネント本体で `css.create()` を呼ぶこと。
- 自分自身を表す `&` を書くこと。
- 関数形式の疑似クラスの引数以外で結合子（`>`、`+`、`~`、空白）を使うこと。親の状態に応じて子孫を変えるときは、まず `css.marker()` と `css.extended()` を使います。
- `.title` などのクラス名をキーにすること。子要素に直接スタイルを付けてください。
- 疑似セレクターの中に疑似セレクターを書くこと。`':hover::before'` のように一つのキーにまとめます。
- 疑似セレクターの中にメディアクエリーやコンテナークエリーを書くこと。逆の順序なら一段だけ入れ子にできます。
- 同じ要素に `className` と `sx` を混ぜること。
- `css.use()` の結果と、インラインの `style` prop を組み合わせること。
- 関数で作ったスタイルを `css.use()` に渡すこと。`Style` 型の prop を経由する場合も同じです。
- 受け取った `Style` を別のコンポーネントへ転送すること。自分が描画する要素に使います。
- `css.use()` の結果をほかのクラス名と連結すること。`className` 経由で届いた別の `css.use()` の結果も同様です。`clsx` や `css.use()` にその結果を渡さず、すべてのスタイルを一度の `css.use()` に渡してください。
- 名前空間の import から文字列キー、分割代入、残余要素で定義を取り出すことや、名前空間全体を渡すこと。`tokens.blue` のように名前で参照します。
- 関数で定義したスタイルの引数で Plumeria の定義を読むこと。定義は `css.create()` の中で読みます。

## 仕組み

AIアシスタントは、ランタイムのCSS-in-JSの習慣をPlumeriaに誤って適用することがよくあります。メンタルモデルを正してください：

- **スタイルはランタイムオブジェクトではなく、タイプスキーマです。** Plumeriaの定義はコンパイラによって読み取られる静的スキーマであり、ランタイムではJavaScriptオブジェクトとして存在しません。
- **`css.create()` はコンパイラディレクティブであり、オブジェクトファクトリーではありません。** それの中のすべては静的分析されます — コンパイラはコードを実行せずにすべてのスタイル情報を読むことができる必要があります。
- **`sx`は`className`ではありません。** Plumeriaは独自の`sx`プロパティを通じてスタイルを結合します。決して反射的に`className`に手を伸ばさないでください。
- **JSバンドル内のゼロバイトCSS。** すべてのCSSはビルド時に解釈されます。抽象層（あなたの定義）と出力層（生成されたCSS）は完全に分離されているため、Plumeriaには副作用がなく、参照透明性が高いです。

## 基本の使い方

モジュールのトップレベルで`css.create()`でスタイルを定義し、`sx`でそれらを結合します。

```tsx
import * as css from '@plumeria/core';

const styles = css.create({
  container: {
    display: 'flex',
    padding: '16px',
  },
  active: {
    backgroundColor: 'blue',
  },
});

export const MyComponent = ({ isActive }) => {
  return (
    <div sx={[styles.container, isActive && styles.active]}>
      Hello Plumeria
    </div>
  );
};
```

**右側優先の構成.** `sx` は配列、三項演算子、条件式を受け付けます。右側のスタイルが常に優先されます：上にある `styles.active` は `isActive` が真である場合に `styles.container` を上書きします。`css.use()` も同じルールに従います。単一のスタイル内で、重なる擬似クラスの状態を解決するためにソースの順序に依存しないでください。複合セレクターを明示的に宣言してください（セレクタールールを参照）。

**クロスファイルインポート。** スタイルはファイル間でインポートできます。`sx`でそれらを適用するファイルは、追加の設定なしでコンパイルされますが、他のプロパティを通じてコンポーネントにそれらを渡すファイルは、必ず `import "@plumeria/core";` を含める必要があります — インポートがコンパイラがファイルを見つける方法です。インポートをすべての消費ファイルに保持することは常に正しいものであり、最も速い方法です。なぜなら、コンパイラはそのようなファイルをさらに調べずに受け入れるからです。

**パッケージからの定義。** `@plumeria/wind` のように、`exports` が TypeScript ソースに `plumeria` 条件を指すパッケージは、依存関係にリストされているアプリによってローカルモジュールとして読み取られます。条件がないパッケージは読み取られません。別の Plumeria パッケージから定義を読み取るパッケージは、アプリの依存関係に両方が必要です。アプリが最初のものをのみリストしている場合、ビルドは成功しますが、2つ目のものを読み取る宣言は削除されます。

**パッケージ内のコンポーネント。** アプリのビルドでは、そのパッケージ内のコンポーネントとアプリ自身のファイルが一緒にコンパイルされるため、アプリがそれらに渡す`sx`はローカルコンポーネントと同様にビルド時に決定され、バンドラープラグインにはそれに関する設定は不要です。以下のパターン1またはパターン2でコンポーネントを作成してください：レンダリングする要素に受け取ったスタイルを適用します。エクスポートが指しているディレクトリ内のすべてのファイルがコンパイルされるため、テストやストーリーはそれら外に置いてください。`default`条件をdistに指すパッケージは、Plumeriaをインストールしていないアプリにそのdistを渡しますが、その場合、アプリの`sx`は適用されません。

**コンパイルされ除外されるインポート**。名前がすべてコンパイルされ除外されるインポートは出力から削除されるため、定義のためにのみインポートされたモジュールはそれを通じて読み込まれません。モジュールがインポート時に実行される必要がある場合は、その横に `import './tokens';` を追加してください。実行時に引き続き読み込まれ、コンポーネントとしてレンダリングされ、再エクスポートされるインポートは残ります。

## 使えない書き方

これらのパターンは決して生成しないでください。それらは静的分析を壊したり、実行時のエラーを引き起こしたりします。

**オブジェクトを直接 `sx` に渡す：**

```tsx
<span sx={{ fontSize: '12px' }}>Small Text</span>
```

**コンポーネントボディ内のスタイルを作成する：**

```tsx
export const BadComponent = ({ dynamicColor }) => {
  const dynamicStyles = css.create({
    dynamic: {
      color: dynamicColor,
    },
  });
  // ...
};
```

**同じ要素に `className` と `sx` を混ぜる：**

```tsx
<span className="global-class" sx={styles.base}>Text</span>
```

**`css.use()`の出力と他のクラス名との結合：**

```tsx
// Box.tsx
export const Box = ({ className }: { className?: string }) => (
  <div className={css.use(styles.base) + ' ' + className} />
);

// Parent.tsx
<Box className={css.use(styles.blue)} />
```

別々の呼び出しからの文字列は結合されず、どのルールが優先されるかはスタイルシートの順序によります。代わりに `css.Style` プロパティを受け取り、同じ呼び出しに渡してください。例：`css.use(styles.base, style)`。（→ カスタムコンポーネントのスタイル設定）

**名前以外の何者からもネームスペースのインポートから定義を読み取る：**

```tsx
import * as tokens from './tokens';

const { styles } = tokens;

<div sx={tokens['styles'].card} />
```

定義のすべての使用はビルド時にその場所に書き込まれるため、コンパイラはどのものが読み込まれているかを確認する必要があります。`tokens.styles.card`は`import { styles } from './tokens'`のようにコンパイルされます。文字列キー、デストラクチャリング、残要素、または`tokens`を全体として渡すと、ビルドが停止します。

**スタイル値内の複雑なJS表現。** 単純な三項演算子のみが許可され、必要に応じてのみ使用してください。スタイル値内に複雑なロジックや関数呼び出しは決して入れないでください。

## セレクター

Plumeriaは、偽クラス、偽要素、属性セレクタルのネストを厳格なルールに従ってサポートします：

- **`&`は使用しないでください。** Plumeriaは`&`自己参照文字を使用しません。
- **ネストされたキーは必ず `:` または `[` で始まわなければなりません。** 擬似クラス/要素は `:` で始まります；属性セレクターは `[` で始まります。
- **コンビナタは機能的な擬似クラス内部でのみ使用できます。** `>`, `+`, `~`、そして子クラスのスペースは他の場所では拒否されます。`:has()`, `:is()`, `:where()`は受け入れられ、それの中のコンビナタ（例：`':has(> img)'`）は、あなたが書かないマークアップのためのエスケープハッチです。親ステートまたは子クラスのスタイル設定には、ペアリングされた`css.marker()`/`css.extended()`API（詳細はAdvanced APIsを参照）を優先してください。これらのAPIはDOMパスを名付けないので、要素を移動してもそれらが壊れません。
- **クラス名キーは使用できません。** `.title` などのキーはサポートされていません。代わりに、子要素に直接 Plumeria スタイルを適用してください。
- **pseudo の内部に pseudo は使用しないでください。** 複合 pseudo-セレクターを1つのキーとして記述してください。例：`':hover::before'`。
- **同じ名前の機能的な偽クラスの内包は、`:not()`を除いて禁止されています。** `':is(:where(:is(.a)))'` はビルドを停止します；異なる名前は内包できますし、`':not(:not(.a), .b)'` は許可されています。キーは括弧を16レベル以上内包したり、余分な引用符を保持したりすることはできません。
- **重複するステータスを明示的に宣言してください。** `:hover`、`:focus`、`:active` などの擬似クラスは同時に一致できます。2つのステータスが同じプロパティを設定している場合は、交差点が取るべき値で複合セレクタを宣言してください。異なるプロパティを設定している場合は、複合セレクタは必要ありません。機能的な擬似クラスもカウントされます：同じプロパティを設定している `:nth-child(even)` と `:hover` は、複合 `':nth-child(even):hover'` が必要です。
- **メディア/コンテナクエリのネストは一方通行です。** サードパーティセレクターは、メディア/コンテナクエリの内部にちょうど1回だけネストできます。逆の構文（メディア/コンテナクエリをサードパーティセレクターの内部に置くこと）は禁止されており、コンパイラまたは型エラーを引き起こします。

```tsx
const styles = css.create({
  button: {
    padding: '16px',
    backgroundColor: 'white',
    // VALID: Pseudo-classes and elements (starts with :)
    ':hover': {
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    },
    ':active': {
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    },
    // VALID: :hover and :active can match together; the intersection gets its own value
    ':hover:active': {
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    },
    '::before': {
      display: 'block',
      content: '""',
    },
    // VALID: Attribute selectors (starts with [)
    '[data-active="true"]': {
      borderColor: 'blue',
      borderStyle: 'solid',
      borderWidth: '2px',
    },
    // VALID: Pseudo-selector nested inside a media query (allowed once)
    '@media (max-width: 768px)': {
      padding: '8px',
      ':hover': {
        boxShadow: 'none',
      },
    },
  },
});

// INVALID: media query nested inside a pseudo-selector
const badStyles = css.create({
  button: {
    ':hover': {
      '@media (max-width: 768px)': {
        backgroundColor: 'blue',
      },
    },
  },
});
```

## 動的なスタイル

### 実行時に決まる値

動的値（通常はReactのインライン`style`プロパティが必要となる）の場合、`css.create()`で**関数キー**を定義します。関数キーはCSS変数にコンパイルされるため、インラインスタイルとは異なり、`@media`と`@container`クエリを完全にサポートします：

```tsx
const styles = css.create({
  palette: (color: string) => ({
    backgroundColor: color,
    // Media/container queries work on dynamic styles
    '@media (max-width: 600px)': {
      backgroundColor: 'blue',
    },
  }),
});

// Usage: <div sx={styles.palette(color)} />
```

出力にはそのままの文が届きます。`styles.palette(tokens.blue[500])`のように、そこから読み取られるPlumeriaの定義はコンパイルされず、実行時に値を持っていません。代わりに`css.create()`内で読み取ってください。

### 候補から選ぶ

`css.variants()` APIは、標準の括弧表記（`styles[variant]`）に置き換えられ、削除されました。コンパイラは、ビルド時にこれらの式を定型な照会テーブルに変換します：

```tsx
import * as css from '@plumeria/core';

// 1. Define variants in a dedicated, minimal css.create()
const sizeStyles = css.create({
  small: {
    fontSize: '12px',
  },
  medium: {
    fontSize: '16px',
  },
  large: {
    fontSize: '20px',
  },
});

// 2. Type the variant (string literal union or keyof typeof)
type Size = keyof typeof sizeStyles;

interface ButtonProps {
  size: Size;
  children: React.ReactNode;
}

// 3. Resolve dynamically with bracket notation
export const Button = ({ size, children }: ButtonProps) => {
  return <button sx={sizeStyles[size]}>{children}</button>;
};
```

ベストプラクティス：

- **`css.create()` の呼び出しを最小限に抑えましょう。** ブラケット表記で使用される `css.create()` の各キーは、モジュールに一度だけ宣言されるルックアップテーブルにコンパイルされます（例：`{__proto__:null,"small":"...","medium":"..."}`）。バリエーションを専用の呼び出しに分離し、関連のない定型スタイルと混在させないようにしてください。
- **バリエーションキーはセレクターとしてパースされます：スペースは使用できません。** `css.create()` に含まれるバリエーションキーのすべてのキーはセレクターとして読み取られるため、キーにはスペースやコンビナトリキャラクターを含めるべきではありません。スペースは子コンビナトリであり、ビルドを停止します（`no-combinator`）。表示ラベルにスペースが含まれている場合は、スラッグキーを使用し、レンダリング用のラベルマップを保持してください。例として、ステータス「On leave」はキー `onLeave` に変更され、`const statusLabels = { active: 'Active', onLeave: 'On leave', offline: 'Offline' }` とします。
- **ローカル変数の割り当てがサポートされています。** `const currentStyle = sizeStyles[size]; <div sx={currentStyle} />` は機能します — コンパイラはローカルスタイル変数を追跡し、JSX抽出時にインライン化します。

### css.use() の戻り値

`css.use()`は静的クラス名文字列にコンパイルされます。インラインの`style`プロパティとの**統合**はありません。`css.use()`の出力と`style`を統合または結合しようとすることは絶対にしないでください。関数キーは、インラインまたは`Style`プロパティを通じてそれを通ることはできません。値は`style`のCSS変数として要素に到達しますが、`css.use()`はそれを設定することはありません。

## 用途別の API

### 親の状態を子孫に伝える

これらのペアリングされたAPIは、DOMパスを名付けることなく、コンテキスト認識スタイリング（例：親がホバーされたときに子要素をスタイリングする）を可能にします。

- **`css.marker(id, pseudo)`** — 擬態状態が有効な場合、親要素にCSS変数のマーカーを設定します。必ず親スタイルに広げなければなりません：`...css.marker(...)`。
- **`css.extended(id, pseudo)`** — リンクされたマーカーが有効な間、子要素にスタイルを適用します。計算されたキーとして使用されます：`[css.extended(...)]`。

```tsx
import * as css from '@plumeria/core';

const styles = css.create({
  parent: {
    // 1. Set a marker with the unique id 'card' for the ':hover' state
    ...css.marker('card', ':hover'),
    padding: '24px',
    borderColor: '#ccc',
    borderStyle: 'solid',
    borderWidth: '1px',
  },
  child: {
    transition: 'color 0.3s ease',
    // 2. React to the 'card' marker being active
    [css.extended('card', ':hover')]: {
      color: 'blue',
      // Further pseudo-classes can be nested here
      ':hover': {
        color: 'darkblue',
      },
    },
  },
});

export const Card = () => {
  return (
    <div sx={styles.parent}>
      <span sx={styles.child}>Hover parent to make me blue!</span>
    </div>
  );
};
```

ビルド時に、これは原子的なコンテナスタイルクエリ（`@container style(--x1f9k2q1-card-hover: 1)`）にコンパイルされます — ランタイムオーバーヘッドはゼロ、DOM階層への依存もゼロです。

### `css.createStatic()`

ビルド時にインラインされる定型変数（メディアクエリ文字列など）を定義し、通常は`css.create()`で計算されたキーとして使用されます：

```tsx
import * as css from '@plumeria/core';

export const breakpoints = css.createStatic({
  xs: '@media (max-width: 480px)',
  sm: '@media (max-width: 640px)',
  md: '@media (max-width: 768px)',
  lg: '@media (max-width: 1024px)',
});

export const styles = css.create({
  container: {
    [breakpoints.sm]: {
      padding: 16,
    },
    [breakpoints.lg]: {
      padding: 32,
    },
  },
});
```

カラースケールのように、数値キーは引用符で囲まれます：`'500': '#3b82f6'`。引用符のない数値はビルドを停止します。`blue[500]` または `blue['500']` と読み取ります。

### `css.createTheme()`

テーマ用のスコープ付きCSS変数を定義します。最初の引数：テーマを有効にするセレクター。2番目の引数：`{ default, theme }` の値ペアを持つオブジェクト。生成された変数名はユニークなハッシュでプレフィックスされるため、名前の衝突は起こりません。テーマの値は、スタイルブロックで実際に使用されたときにのみコンパイルされます。

```tsx
import * as css from '@plumeria/core';

// Class-based theme
export const theme = css.createTheme('.dark', {
  text: {
    default: '#333',
    theme: '#eaeaea',
  },
  background: {
    default: 'white',
    theme: 'black',
  },
});

// Attribute selectors and media queries are also supported:
// css.createTheme('[data-theme="dark"]', { ... });
// css.createTheme('@media (prefers-color-scheme: dark)', { ... });
```

### `css.keyframes()`

スタイルルール内で使用するために、ビルド時にインラインされたハッシュであるユニークな `@keyframes` アニメーション名を作成します：

```tsx
import * as css from '@plumeria/core';

const fadeIn = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});

const styles = css.create({
  card: {
    transition: 'transform 0.3s ease',
    ':hover': {
      animationName: fadeIn,
      animationDuration: '0.5s',
    },
  },
});
```

### `css.viewTransitionClass()`

独自の `view-transition-class` を生成し、アニメーション定義（`group`、`imagePair`、`new`、`old`）を受け付けてビュートランジションをカスタマイズします。React の `<ViewTransition>` の `default`、`enter`、`exit`、`update`、または `share` プロパティに渡すか、`css.create` の `viewTransitionClass` で設定します。ルールはこれらの2つの用途に対してのみエミットされるため、コンポーネントのベアラーを通じてではなく、直接 `<ViewTransition>` に渡してください：

```tsx
import * as css from '@plumeria/core';

const fadeIn = css.keyframes({
  from: {
    opacity: 0,
  },
  to: {
    opacity: 1,
  },
});

const fadeOut = css.keyframes({
  from: {
    opacity: 1,
  },
  to: {
    opacity: 0,
  },
});

const longCrossFade = css.viewTransitionClass({
  old: {
    animationName: fadeOut,
    animationDuration: '1.2s',
  },
  new: {
    animationName: fadeIn,
    animationDuration: '1.2s',
  },
});

// React usage:
// <ViewTransition default={longCrossFade}>...</ViewTransition>
// <ViewTransition name={`photo-${id}`} share={longCrossFade}>...</ViewTransition>
```

### `css.varType()`

`@property`で入力されたカスタムプロパティを登録し、その名前を返します。値を設定するためにキーとして使用し、`var()`の内部で読み取るために使用します。`'*'`を除くすべての`syntax`には`initialValue`が必要です。また、使用場所（`em`、`rem`、コンテナ単位、または`var()`など）に依存してはなりません。

```tsx
import * as css from '@plumeria/core';

const angle = css.varType({
  syntax: '<angle>',
  initialValue: '0deg',
});

export const styles = css.create({
  ring: {
    background: `conic-gradient(from var(${angle}), red, blue)`,
    transition: `${angle} 0.6s ease`,
    ':hover': {
      [angle]: '180deg',
    },
  },
});
```

### `css.positionTry()`

`@position-try`ルールを定義し、`positionTryFallbacks`に対してそのドット付き名値を返します。`positionAnchor`、`positionArea`、インセット、マージン、サイズ付け、セルフアライメントプロパティのみを受け付けます：

```tsx
import * as css from '@plumeria/core';

const above = css.positionTry({
  positionArea: 'top',
  marginBottom: 8,
});

export const styles = css.create({
  tooltip: {
    position: 'absolute',
    positionAnchor: '--trigger',
    positionArea: 'bottom',
    positionTryFallbacks: `${above}, flip-inline`,
  },
});
```

## 自作コンポーネント

カスタムコンポーネントにPlumeriaスタイルを適用するためのパターンは、正確に**2つ**あります。どちらの場合も、コンパイルは`sx`の呼び出し場所で行われ、コンポーネント自体はコンパイルされた`className`/`style`をDOMに渡すだけです。

> **コア原則**: `Style`として入力されたカスタムプロパティはコンパイラによって静的にトレースされるため、スタイルはコンポーネント境界をスムーズに渡ります。

### 要素に直接指定する

コンポーネントは独自のスタイルをインポートし、内部で適用します。最もシンプルなパターンは完全に自立したものです：

```tsx
import React from 'react';
import * as css from '@plumeria/core';

const styles = css.create({
  button: {
    padding: '10px',
    color: '#fff',
    cursor: 'pointer',
    backgroundColor: 'navy',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: 'medium',
    borderRadius: '4px',
  },
});

export const Button = ({ children }: { children: React.ReactNode }) => {
  return (
    // The compiler transforms sx → className here
    <button sx={styles.button}>
      {children}
    </button>
  );
};

// Usage
<Button>Click me</Button>;
```

### Style 型で受け取る

コンポーネントは、`css.Style` の型で指定されたプロップを通じてスタイルを受け取ります。そのプロップ名は `sx` 本身、または他の任意の名前（例：`styleArray`）で指定できます。コンパイラはコンポーネント自身のパラメータリストを読み取ります。コンポーネントが宣言するプロップは、要素が受け取るクラス名ではなく、検索テーブルが解決するキーが割り当てられるため、スタイルはコンポーネント境界を越えてトレースされ、内部要素の `sx` によって適用されます。ビルドで一度もスキャンされないコンポーネント（依存関係からのコンポーネント）は、コンパイラが読み取れる宣言を行わないため、その上に書かれた `sx` は依然として呼び出し場所でクラス名に解決されます。これは、`className` を自身の要素にフォワードするコンポーネントが必要とするものです。`[styles.text, styleArray]` のようにコンポーネンドすることで、呼び出し場所のスタイルはコンポーネントのベーススタイルをオーバーライドできます（右側が優先 — Core Usage を参照）。以下のように、呼び出し場所の `fontSize: '24px'` は内部の `fontSize: '12px'` をオーバーライドします。

```tsx
// --- Button.tsx ---
import React from 'react';
import * as css from '@plumeria/core';

type ButtonProps = {
  children: React.ReactNode;
  styleArray?: css.Style;
};

// base style
const styles = css.create({
  text: {
    fontSize: '12px',
  },
});

// Pass styleArray directly to the inner element's sx
export const Button = ({ children, styleArray }: ButtonProps) => {
  return <button sx={[styles.text, styleArray]}>{children}</button>;
};

// --- Usage (call site) ---
import * as css from '@plumeria/core';
import { Button } from './Button';

const styles = css.create({
  primary: {
    padding: '10px',
    color: '#fff',
    backgroundColor: 'navy',
  },
  text: {
    fontSize: '24px',
  },
});

// The compiler traces styleArray and resolves it statically
<Button styleArray={[styles.primary, styles.text]}>Click me</Button>;
```

### 自分の要素には sx を使う

コンポーネントがレンダリングする要素にスタイルを適用するために、`css.use()`でスタイルを解決することは決してしないでください。`sx`も同じ役割を果たし、`css.use()`では扱えない関数キーも含まれています。パターン1またはパターン2は、レンダリングするすべての要素をカバーします：

```tsx
// INVALID: sx applies these to an element you render
<button className={css.use(styles.text, styleArray)}>{children}</button>

// VALID
<button sx={[styles.text, styleArray]}>{children}</button>
```

`css.use()`は、`sx`が到達できない場所で使用されます。具体的には、プロパティに`Style`型がないサードパーティコンポーネント、`overlayClassName`などの別の名前を持つクラス名プロパティ、そしてJSX（Vue、Svelte、Astro）ではないテンプレートです。オプションインフラの`@plumeria/no-use-in-jsx`リントルールは、これらの使用が全く必要ないプロジェクトにおけるJSX内のすべての`css.use()`を報告します。

### Style を別のコンポーネントに転送しない

`Style` プロパティを受け取るコンポーネントは、レンダリングする要素にそれを適用する必要があります — `sx` に直接適用するか、`css.use()` を通じて適用するかです。適用されないスタイルプロパティはビルドエラーであり、別のコンポーネントに渡されたときに発生するものです。

これが決まるのは、コンポーネントがどのくらいのスタイルプロパティを使用するかではなく、**スタイルがどこまで拡張されるか**です。スタイルを渡すことは常に問題ありません：

```tsx
// VALID: every value is a style, so any number of style props is fine
<Layout
  headerStyle={styles.header}
  bodyStyle={styles.body}
  buttonStyle={styles.button}
/>
```

適用する代わりにそれを一つ先に転送することは次のものではありません：

```tsx
// INVALID: headerStyle reaches no element of this component
export const Layout = ({ headerStyle }: { headerStyle?: css.Style }) => {
  return <Header headerStyle={headerStyle} />;
};
```

```
[plumeria] "headerStyle" is a style received through a prop but is never applied
to sx or css.use() here. Apply it on an element this component renders;
a style prop cannot be passed on to another component.
```

代わりにこれらの一つを書いてください：

```tsx
// VALID: Apply it on an element this component renders
export const Layout = ({ headerStyle }: { headerStyle?: css.Style }) => {
  return <header sx={[styles.base, headerStyle]}>...</header>;
};

// VALID: Or drop the middle component and style the one that owns the element
<Header headerStyle={[styles.base, styles.primary]} />;
```

ベーススタイル — `[styles.base, headerStyle]` — の下で結合することはサポートされている形状です。拒否されるのは *リレー* です：適用されることなく、ただ転送されるだけのプロパティです。

受信スタイルも、別のファイルからでも、同じスタイルが要素にも適用されている場合でも、`sx`を宣言しているコンポーネントへは`sx`を介して渡すことはできません：

```tsx
// INVALID: Header declares sx
export const Layout = ({ sx }: { sx?: css.Style }) => {
  return <Header sx={[styles.base, sx]} />;
};
```

```
[plumeria] "sx" is a style received through a prop and cannot be passed on
to a component that declares sx. Apply it on an element this component renders.
```

ビルドがスキャンすることのないコンポーネントは何も宣言していないため、受信したスタイルコンポーネントがそれ上に構成され、呼び出し場所でクラス名に解釈されます。

```tsx
// VALID: Dialog.Trigger comes from @plumeria/headlessui, a dependency
export const OpenButton = ({ sx }: { sx?: css.Style }) => {
  return <Dialog.Trigger sx={[styles.base, sx]}>Open</Dialog.Trigger>;
};
```

したがって、上記の有効なコールサイトは、`Layout`が3つのプロパティをすべて自身で適用している間だけ有効です。それらを子要素にルーティングした場合、適用されていない各プロパティはエラーとなります。これは、スタイルがそれらの要素を所有するコンポーネントに属していることを示すシグナルです。

プロップドリリングはReactにおける独自のパターンアブソーブメントであり、ここではまた解決不能です。コンパイラがルックアップテーブルを構築するために、任意のワッパーのチェーン全体を横断してスタイルを追跡しなければならないからです。これを拒否することで、境界条件を決定可能にし、生成されるCSSを正確に保つことができます。

### 使い分け

| パターン | まとめサイト | コンポーネントの役割 |
|---------|-----------------|-----------------|
| 1. `sx`を直接 | コンポーネントの内部 | 自立したスタイル |
| 2. `Style`プロパティ | 追跡してまとめました | `Style`を受け取り、適用します。 |

どちらのパターンでも、コンポーネントは受け取ったスタイルを**適用**します。それらはいずれもそれを転送しません。

## Tailwind CSS から移す

TailwindのモデルとPlumeriaのモデルは1対1で対応していません。ユーティリティごとに書き直すリライトでは、コンパイル失敗、静かに動作停止、またはTailwindを再実装したかのようなコードが生成されます。3つのルールに従って、1つのコンポーネントずつ移行してください。

**コンパイルされたスタイルシートから値を解釈し、記憶から決して読み込まないでください。** ユーティリティ値は固定テーブルではなく、プロジェクトの `@theme` から取得されます：`p-4` は `calc(var(--spacing) * 4)` で、`text-sm` は `font-size` とペアリングされた `line-height` を設定し、カラースケールはプロジェクトが定義した通りです。プロジェクトをビルドし、出力された CSS から宣言を読み取ってください。

**決して `--tw-*` 変数チェーンを渡さないでください。** `shadow-lg` は `--tw-shadow: …` と `box-shadow: var(--tw-inset-shadow), …, var(--tw-shadow)` にコンパイルされ、これらの変数は Tailwind が `@property` でそれらを登録しているためだけに値を持っています。文字通りコピーすると、宣言は無効になり、シャドウは消えます。代わりに、チェーンを最終的な値に解決してください。

**コンパイルされた値がTailwindのデフォルト値の場合、`@plumeria/wind`から読み取ります。** このパッケージは、`css.createStatic`トークンとしてTailwind CSS v4のデフォルトテーマを保持しており、各トークンはそれを読み取るスタイルにコンパイルされるため、何もバンドルに到達しません。`pnpm i -D @plumeria/wind`でインストールし、`import * as t from '@plumeria/wind'`でインポートしてください。プロジェクトの`@theme`については一切認識していないため、トークンを出力されたCSSと比較し、両者が異なる部分にのみ出力された値を保持してください。ユーティリティクラスは生成されないため、以下のキー名付けは引き続き適用されます。

| Tailwind | `@plumeria/wind` |
|---|---|
| `p-4` | `padding: t.spacing[4]` |
| `text-sm` | `fontSize: t.text.sm`, `lineHeight: t.textLineHeight.sm` |
| `font-medium` | `fontWeight: t.fontWeight.medium` |
| `bg-blue-500`, `text-white` | `backgroundColor: t.blue[500]`, `color: t.color.white` |
| `rounded-md` | `borderRadius: t.radius.md` |
| `shadow-lg` | `boxShadow: t.shadow.lg`、解決された値を保持する |
| `md:` | `` [`@media (width >= ${t.breakpoint.md})`] ``。トークンは長さを示すため、クエリをそれの周りに記述してください。単独のキーとして使用すると、ルールは生成されません。 |
| `animate-spin` | `` animation: `${t.spin} ${t.animate.spin}` `` |

**要素が持つユーティリティの後にではなく、要素そのものに従って名前のキーを設定してください。** クラスリストは移行の入力であり、出力ではありません。

```tsx
// INVALID: Tailwind reimplemented — these names carry no more meaning than the class list did
const styles = css.create({
  hoverBgBlue500: {
    ':hover': {
      backgroundColor: '#3b82f6',
    },
  },
  px4: {
    paddingInline: '1rem',
  },
});

// VALID: One key per thing the component has
const styles = css.create({
  submitButton: {
    paddingInline: '1rem',
    backgroundColor: '#2563eb',
    ':hover': {
      backgroundColor: '#3b82f6',
    },
  },
});
```

**翻訳ではなく再構築が必要です。** ブレイクポイント（`md:`）と`data-*`バリアントは、直接 `@media` と属性セレクターキーにマッピングされます。`dark:`はプロジェクトによって異なります：デフォルトでは `@media (prefers-color-scheme: dark)` ですが、`@custom-variant dark` は通常、それを `.dark` クラスセレクターとして再定義します — これは直接のセットではなく、以下の再構築セットに属します。どのものが当てはまるか判断する前に、コンパイルされた出力を確認してください。

| Tailwind | コンパイルされます | 代わりに書きなさい |
|---|---|---|
| `hover:`, `focus:` | `&:hover { @media (hover: hover) { … } }` | `':hover': { … }`、`@media (hover: hover)`のワッパを削除 — Plumeriaは擬似要素内のクエリを禁止します。その後、スタイルはタッチデバイスにも適用されます。 |
| `group-*`, `peer-*` | `&:is(:where(.group):hover *)` | 親に対して `css.marker()`、子に対して `css.extended()` を使用します。`.group` / `.peer` クラスは消えます。 |
| `space-x-*`, `divide-*` | `:where(& > :not(:last-child))` | 子供に直接適用されるマージンまたは境界線 — 子供コンビナタは機能的な擬似クラスの内部でしか受け入れられません。 |

### tv() と twMerge()

| テールウィンドバリエーション | Plumeria |
|---|---|
| `base` | コンポーネント自身の`css.create()`内の静的キー |
| `variants` | バリエーショングループごとに専用の `css.create()` を1つ用意し、括弧表記で読みます（これらの呼び出しは最小限に抑えてください — 括弧表記を参照）。 |
| `defaultVariants` | デフォルトパラメータ値 |
| `compoundVariants` | `sx`配列の明示的な条件 |
| `slots` | 要素ごとに1つの `css.create()`、すべてのスロットを保持する1回の呼び出しではありません。 |

**外部の `className` オーバーライドは `className`ではなく `Style` プロパティになります。** `twMerge(button(...), className)` は呼び出し場所が勝つようにするために存在します；パターン2も同じ役割を果たします。なぜなら配列の順位は右側が優先だからです。**絶対に** オーバーライドを解消したり、`css.use()`で強制したり、混合ルールを回避するためにコンポーネントの公開APIを変更しないでください。**

**実行時に構築されたクラス名は決して推測しないでください。** テンプレート定型式またはプロップまたはステートから読み取った値は、静的には知ることができません。コンポーネントをTailwindに保持し、報告してください。推測されたユーティリティはコンパイルされ、静かに間違っています。

```tsx
// --- Before ---
const button = tv({
  base: 'inline-flex rounded font-medium',
  variants: {
    size: { sm: 'h-8 px-3 text-sm', lg: 'h-12 px-6 text-lg' },
    tone: { primary: 'bg-blue-500 text-white', danger: 'bg-red-500 text-white' },
  },
  compoundVariants: [{ size: 'lg', tone: 'primary', class: 'shadow-lg' }],
  defaultVariants: { size: 'sm', tone: 'primary' },
});

<button className={twMerge(button({ size, tone }), className)} />;

// --- After (values resolved from the project's compiled CSS, not recalled) ---
const styles = css.create({
  base: {
    display: 'inline-flex',
    fontWeight: 500,
    borderRadius: '4px',
  },
  lgPrimary: {
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  },
});

const sizeStyles = css.create({
  sm: {
    height: '32px',
    paddingInline: '12px',
    fontSize: '14px',
  },
  lg: {
    height: '48px',
    paddingInline: '24px',
    fontSize: '18px',
  },
});

const toneStyles = css.create({
  primary: {
    color: '#fff',
    backgroundColor: '#3b82f6',
  },
  danger: {
    color: '#fff',
    backgroundColor: '#ef4444',
  },
});

type ButtonProps = {
  size?: keyof typeof sizeStyles;
  tone?: keyof typeof toneStyles;
  styleArray?: css.Style;
};

export const Button = ({ size = 'sm', tone = 'primary', styleArray }: ButtonProps) => (
  <button
    sx={[
      styles.base,
      sizeStyles[size],
      toneStyles[tone],
      size === 'lg' && tone === 'primary' && styles.lgPrimary,
      styleArray,
    ]}
  />
);
```

デフォルトのテーマを維持するプロジェクトでは、同じ2つのグループが `@plumeria/wind` から読み取ります。

```tsx
import * as css from '@plumeria/core';
import * as t from '@plumeria/wind';

const sizeStyles = css.create({
  sm: {
    height: t.spacing[8],
    paddingInline: t.spacing[3],
    fontSize: t.text.sm,
    lineHeight: t.textLineHeight.sm,
  },
  lg: {
    height: t.spacing[12],
    paddingInline: t.spacing[6],
    fontSize: t.text.lg,
    lineHeight: t.textLineHeight.lg,
  },
});

const toneStyles = css.create({
  primary: {
    color: t.color.white,
    backgroundColor: t.blue[500],
  },
  danger: {
    color: t.color.white,
    backgroundColor: t.red[500],
  },
});
```

## テスト

**絶対に `@plumeria/core` をスタブしないでください。** それはタイプを公開しますが、ランタイムは提供しません。`moduleNameMapper` エントリや手書きのモックがあればスイートは実行できますが、生成されるすべてのクラス名は作られたものであり、テストはスタイルについて何も示しません。ランナーがパッケージを解釈できない場合は、パッケージを偽造するのではなく、別のレイヤーをテストするサインです。

**コンポーネントテストで生成されたクラス名を絶対にアサーションしないでください。** `xvdv6o3r` はハッシュされたプロパティ値のペアの1つです。スタイルにプロパティを追加すると、以前のリストを個別に指定していたすべてのテストが失敗します。コンポーネントがレンダリングするか、保持するか、分岐するかをアサーションしてください。

**コンポーネントの動作をテストするには、トランスフォーマーをランナーのモジュールパイプラインに入れます。** これがそれを必要とする唯一のレイヤーです。Vitestは構成ファイルにプラグインを読み込みます：

```ts
export default defineConfig({
  plugins: [react(), plumeria.vite()],
  test: { environment: 'jsdom' },
});
```

Jestは `@swc/jest`、`ts-jest`、または`babel-jest`の代わりに`@plumeria/swc-jest`を使用します；SWCオプションは`.swcrc`に残るか、トランスフォーマーの隣に配置されます：

```js
module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(t|j)sx?$': '@plumeria/swc-jest' },
};
```

**jsdomはスタイルシートを適用しません。** `document.styleSheets`は空であり、`getComputedStyle`は初期値を返します。そこにあるテストでは、どのクラスが添付されたかを確認できますが、それが何をすることかは確認できません。カスケードに関すること（特定の性、`@media`、`extended`付きの`marker`など）は、実際のブラウザに対するエンドツーエンドのテストに属します。

## ツールの設定

**設定方法。** コンフィギュレーションを手動で記述しないでください。`npx @plumeria/init`はパッケージマネージャとバンドラーを検出し、パッケージをインストールし、`plumeria.d.ts`とバンドラーの構成ファイルを書き込み、ESLintのフラット構成を拡張し、esbuildとBunでは`build`スクリプトの前に`plumeria-lint --`を置きます。その他のバンドラープラグインは、ビルド自体をリントします。書き込み前に計画が表示され、`--dry-run`は計画の時点で停止し、`--yes`は問い合わせなしにすべてのデフォルト設定を使用するため、TTYなしでも使用できます。すでに設定済みのプロジェクトは完了と読み取られ、何も書き込まれません。

**コンパイラの期待事項。** コンパイラは`css.create()`呼び出しを静的的に抽出するため、それらは必ずモジュールのトップレベルに配置する必要があります。直接的で明確に定義された参照を優先してください。間接的な変数の参照は分析できない場合があります。

**ESLintの保証**。`@plumeria/eslint-plugin`はPlumeriaのルールを強制します。そのエラーはブロックするものとして扱い、警告（`no-order-dependent-overlap`など）はノイズではなく、解決すべき欠陥として扱います。チェック対象は次のとおりです：

- **CSSプロパティ値検証** —無効な値はリント時に検出されます。
- **属性の並べ替え順序** — 1つの標準的な順序が強制されます。完全な順序は、以下の**属性の順序**で指定されています。
- **プロパティフォーマット** — プロパティは1行に1つ、プロパティ間の空白は不要です。詳細は以下の**プロパティフォーマット**をご覧ください。
- **未使用スタイル検出** — 未使用のスタイルは自動的にフラグ付けされます。

プラグインのルールは、`README.md`に記載されている通りに従ってください。

**プロパティの順序。** プロパティは必ず `sort-properties` が強制する順序で表示されなければならず、警告がビルドを停止するため、最初からこの順序で記述してください — グループごとに、そしてグループ内はリストされている順序で：

1. composes
2. all
3. position, positionAnchor, positionArea, positionTry, positionTryOrder, positionTryFallbacks, positionVisibility, anchorName, anchorScope, inset, insetBlock, insetBlockStart, insetBlockEnd, insetInline, insetInlineStart, insetInlineEnd, top, right, bottom, left, zIndex, float, clear
4. boxSizing, display, visibility
5. flex, flexGrow, flexShrink, flexBasis, flexFlow, flexDirection, flexWrap, WebkitBoxOrient
6. grid, gridArea, gridTemplate, gridTemplateAreas, gridTemplateRows, gridTemplateColumns, gridRow, gridRowStart, gridRowEnd, gridColumn, gridColumnStart, gridColumnEnd, gridAutoRows, gridAutoColumns, gridAutoFlow, gridGap, gridRowGap, gridColumnGap
7. gap, rowGap, columnGap, placeContent, placeItems, placeSelf, alignContent, alignItems, alignSelf, justifyContent, justifyItems, justifySelf
8. order
9. inlineSize, minInlineSize, maxInlineSize, width, minWidth, maxWidth, blockSize, minBlockSize, maxBlockSize, height, minHeight, maxHeight, aspectRatio
10. padding, paddingBlock, paddingBlockStart, paddingBlockEnd, paddingInline, paddingInlineStart, paddingInlineEnd, paddingTop, paddingRight, paddingBottom, paddingLeft, margin, marginBlock, marginBlockStart, marginBlockEnd, marginInline, marginInlineStart, marginInlineEnd, marginTop, marginRight, marginBottom, marginLeft
11. overflow, overflowInline, overflowBlock, overflowX, overflowY, scrollbarGutter, WebkitOverflowScrolling, msOverflowX, msOverflowY, msOverflowStyle, textOverflow, WebkitLineClamp, lineClamp, scrollBehavior
12. overscrollBehavior, overscrollBehaviorInline, overscrollBehaviorBlock, overscrollBehaviorX, overscrollBehaviorY
13. font, fontFamily, fontSize, fontSizeAdjust, fontVariationSettings, fontStyle, fontWeight, fontOpticalSizing, fontStretch, fontFeatureSettings, fontKerning, fontVariant, fontVariantLigatures, fontVariantCaps, fontVariantAlternates, fontVariantNumeric, fontVariantEastAsian, fontVariantPosition, WebkitFontSmoothing, MozOsxFontSmoothing, fontSmooth
14. lineHeight, verticalAlign, alignmentBaseline, baselineShift, dominantBaseline
15. color, WebkitTextFillColor, WebkitTextStroke, WebkitTextStrokeWidth, WebkitTextStrokeColor
16. textAlign, textAlignLast, textJustify, textIndent, textTransform, wordSpacing, letterSpacing, hyphens, wordBreak, textWrap, wordWrap, overflowWrap, tabSize, whiteSpace, whiteSpaceCollapse
17. textEmphasis, textEmphasisColor, textEmphasisStyle, textEmphasisPosition, textDecoration, textDecorationLine, textDecorationThickness, textDecorationStyle, textDecorationColor, textUnderlinePosition, textUnderlineOffset, textShadow
18. src, fontDisplay, unicodeRange, sizeAdjust, ascentOverride, descentOverride, lineGapOverride
19. appearance, accentColor, pointerEvents, msTouchAction, touchAction, cursor, caretColor, zoom, resize, userSelect, WebkitUserSelect, navIndex, navUp, navRight, navDown, navLeft, outline, outlineWidth, outlineStyle, outlineColor, outlineOffset
20. colorScheme
21. tableLayout, emptyCells, captionSide, borderSpacing, borderCollapse
22. content, quotes
23. listStyle, listStylePosition, listStyleType, listStyleImage, counterReset, counterSet, counterIncrement
24. scrollSnapType, scrollSnapAlign, scrollSnapStop, scrollPadding, scrollPaddingBlock, scrollPaddingBlockStart, scrollPaddingBlockEnd, scrollPaddingInline, scrollPaddingInlineStart, scrollPaddingInlineEnd, scrollPaddingTop, scrollPaddingRight, scrollPaddingBottom, scrollPaddingLeft, scrollMargin, scrollMarginBlock, scrollMarginBlockStart, scrollMarginBlockEnd, scrollMarginInline, scrollMarginInlineStart, scrollMarginInlineEnd, scrollMarginTop, scrollMarginRight, scrollMarginBottom, scrollMarginLeft
25. scrollbarColor, scrollbarWidth
26. objectFit, objectPosition, msInterpolationMode, imageOrientation, imageRendering, imageResolution
27. background, backgroundColor, backgroundImage, backgroundRepeat, backgroundAttachment, backgroundPosition, backgroundPositionX, backgroundPositionY, backgroundClip, backgroundOrigin, backgroundSize, border, borderColor, borderStyle, borderWidth, borderBlock, borderBlockColor, borderBlockStyle, borderBlockWidth, borderBlockStart, borderBlockStartColor, borderBlockStartStyle, borderBlockStartWidth, borderBlockEnd, borderBlockEndColor, borderBlockEndStyle, borderBlockEndWidth, borderInline, borderInlineColor, borderInlineStyle, borderInlineWidth, borderInlineStart, borderInlineStartColor, borderInlineStartStyle, borderInlineStartWidth, borderInlineEnd, borderInlineEndColor, borderInlineEndStyle, borderInlineEndWidth, borderTop, borderTopColor, borderTopStyle, borderTopWidth, borderRight, borderRightColor, borderRightStyle, borderRightWidth, borderBottom, borderBottomColor, borderBottomStyle, borderBottomWidth, borderLeft, borderLeftColor, borderLeftStyle, borderLeftWidth, borderRadius, borderStartStartRadius, borderStartEndRadius, borderEndStartRadius, borderEndEndRadius, borderTopLeftRadius, borderTopRightRadius, borderBottomRightRadius, borderBottomLeftRadius, borderImage, borderImageSource, borderImageSlice, borderImageWidth, borderImageOutset, borderImageRepeat, boxShadow
28. backgroundBlendMode, isolation, mixBlendMode
29. filter, backdropFilter
30. clip, clipPath, maskBorder, maskBorderSource, maskBorderSlice, maskBorderWidth, maskBorderOutset, maskBorderRepeat, maskBorderMode, mask, maskImage, maskMode, maskRepeat, maskPosition, maskClip, maskOrigin, maskSize, maskComposite
31. writingMode
32. textAnchor, fill, fillRule, fillOpacity, stroke, strokeOpacity, strokeWidth, strokeLinecap, strokeLinejoin, strokeMiterlimit, strokeDasharray, strokeDashoffset, colorInterpolation, colorInterpolationFilters, floodColor, floodOpacity, lightingColor, markerStart, markerMid, markerEnd, stopColor, stopOpacity, shapeRendering
33. transform, transformOrigin, rotate, scale, translate, perspective, perspectiveOrigin
34. transition, transitionDelay, transitionTimingFunction, transitionDuration, transitionProperty
35. animation, animationName, animationDuration, animationTimingFunction, animationDelay, animationIterationCount, animationDirection, animationFillMode, animationPlayState, animationComposition, animationTimeline, animationRange, animationRangeStart, animationRangeEnd
36. willChange
37. breakBefore, breakAfter, breakInside, widows, orphans

すべてのプレーンプロパティの後に、内包キーは次の順序で続きます：疑似セレクター（`:hover` など）、次に `&` セレクター、次に `@media` と `@container` ブロックです。リストに表示されないプロパティは、リストに表示されているプロパティの後に、セレクターの前に並べられます。

**ボーダーの略語。** `border`, `borderBlock`, `borderInline`, `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `borderBlockStart`, `borderBlockEnd`, `borderInlineStart`, `borderInlineEnd` を決して記述しないでください。ボーダーの略語は、値名がそれらのうちの1つのみを指す場合でも、常に幅、スタイル、色を同時に設定し、`expand-border-shorthands` はそれを拒否します。代わりに、それに対応する3つの宣言文を記述してください — `borderColor`, `borderStyle`, `borderWidth`、または `borderTopColor`, `borderTopStyle`, `borderTopWidth` などの各側の形式です。例えば、`border: 'none'` は次のように変更されます：

```ts
borderColor: 'currentColor',
borderStyle: 'none',
borderWidth: 'medium',
```

各側のフォームは独自の3つの長手方向に拡張され、軸のフォーム（`borderBlock`、`borderInline`）も同様に `borderBlockColor`、`borderBlockStyle`、`borderBlockWidth`、およびそれらの `borderInline` 対応部分に拡張されます。たとえば、`borderTop: '1px solid #d1d5db'` は次のように変更されます：

```ts
borderTopColor: '#d1d5db',
borderTopStyle: 'solid',
borderTopWidth: '1px',
```

値が名前付けされていないコンポーネントは、初期値（幅 `medium`、スタイル `none`、色 `currentColor`）を受け取り、それでも出力されます。そのため、`borderInlineStart: '2px dashed'` は次のように表示されます：

```ts
borderInlineStartColor: 'currentColor',
borderInlineStartStyle: 'dashed',
borderInlineStartWidth: '2px',
```

**プロパティのフォーマット.** スタイルオブジェクトでは、各プロパティはそれぞれ別の行に配置され、プロパティ間の空白行はありません。`format-properties`は共有行と空白行の両方を拒否し、警告がビルドを停止するため、記述する際はコンパクトオブジェクトを拡張してください。次のようなバリエーションマップエントリ：

```ts
design: { color: '#1d4ed8', backgroundColor: '#dbeafe' },
```

は書かれています：

```ts
design: {
  color: '#1d4ed8',
  backgroundColor: '#dbeafe',
},
```
