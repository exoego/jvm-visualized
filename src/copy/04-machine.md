# 04 実行時の解説文

<!-- 各項目は key を書いたコメント行で始まる。続く「## 」の行が見出し用のラベル、その下が本文。本文は 1 段落 1 行の文。{name} はコードが埋める値。 -->

<!-- boot -->
## JVM を起動し、Greeter をロード

`java Greeter` を実行すると、JVM は最初のクラスとして Greeter を作ります。クラスローダーが Greeter.class のバイト列を読み、クラスを作ります。Object や System などの JDK のクラスは、起動の途中ですでに用意されています。

<!-- rcp -->
## 実行時定数プールを作る

class ファイルの定数プールから、クラスごとの**実行時定数プール**ができます。ここに並ぶのは、命令が使うエントリです。クラスやメソッドへの参照は名前の文字列でできた**記号参照**のままで、まだ何にも結びついていません。

<!-- link -->
## リンク — 検証と準備

バイトコードが安全に実行できるかを**検証**します。続く**準備**では static フィールドの領域を作り、既定値を入れます。

<!-- link-default -->

`{name}` はまだ {value} です。

<!-- init -->
## 初期化

<!-- init-constants -->

ConstantValue 属性を持つ static final フィールドには、ここで定数プールの値が入ります。{assigned}。

<!-- init-assigned -->
## `{name}` ← `#{index}` の {value}

<!-- init-intern -->

String の値は、intern された文字列への参照です。

<!-- init-clinit -->

続いて `<clinit>` を実行します。

<!-- init-no-clinit -->

{self} には `<clinit>` がないので、実行するコードはありません。

<!-- main -->
## main を呼び出す

`public static void main(String[])` を呼びます。**フレーム**が 1 つ積まれ、ローカル変数 0 番に引数の配列が入ります。オペランドスタックの枠の数は、Code 属性の max_stack で決まっています。

<!-- field -->
## フィールド

<!-- method -->
## メソッド

<!-- resolve -->
## `{mnemonic} #{index}` — 記号参照を解決する

`{mnemonic}` は `#{index}` の {kind} を使います。まだ解決されていないので、ここで解決します。

<!-- resolve-class-cached -->

まずクラスを解決しますが、`#{classIndex}` は前の命令がすでに解決しているので、その結果を使います。

<!-- resolve-class-fresh -->

まず class_index が指すクラスを解決し (§5.4.3.1)、次に NameAndType から名前と記述子を取り出します。

<!-- resolve-jdk-note -->

`{className}` は JDK のクラスで、すでにロードされています。

<!-- chain-class-done -->
## class_index `#{classIndex}` は解決済み → `{className}`

<!-- chain-class-resolve -->
## class_index `#{classIndex}` → クラス `{className}` を解決

<!-- chain-nat -->
## name_and_type_index `#{natIndex}` → `{name}` `{descriptor}`

<!-- chain-lookup -->
## `{className}` とその親クラスから{what}を探す

<!-- chain-record -->
## 見つけた{what}への参照を `#{index}` に記録

<!-- resolved -->
## `#{index}` を解決しました

{className} に{what} `{name}` が見つかりました。その参照が `#{index}` に記録されます。この先 `#{index}` を使う命令は、どれも解決の手順を繰り返しません (§5.4.3)。

<!-- cache-note -->

`#{index}` は解決済みなので、記録された結果をそのまま使います。

<!-- aload -->
## `{mnemonic}` — ローカル変数を積む

ローカル変数 {n} 番の参照 {value} を、オペランドスタックに積みます。定数プールは使いません。

<!-- astore -->
## `astore_1` — ローカル変数に保存

スタックの一番上の参照 {value} を取り出し、ローカル変数 1 番に保存します。

<!-- dup -->
## `dup` — 一番上を複製

スタックの一番上の参照を複製します。1 つはこのあとの `<init>` の呼び出しで使われ、もう 1 つがスタックに残ります。

<!-- new-resolve -->
## `new #{index}` — クラスを解決する

`new` は記号参照 `#{index}` を使います。まだ解決されていません。Class エントリの name_index `#{nameIndex}` をたどると、名前は `{name}` です。

<!-- new-chain-name -->
## name_index `#{nameIndex}` → `{name}`

<!-- new-chain-find -->
## Greeter を定義したクラスローダーで `{name}` を探す

<!-- new-chain-record -->
## アクセスできるかを確かめ、結果を `#{index}` に記録

<!-- new-resolved -->
## `#{index}` を解決しました

`{name}` はすでにロードされているクラスです。新しくロードはせず、そのクラスへの参照を `#{index}` に記録します。

<!-- new-alloc -->
## `new` — インスタンスを確保

`{name}` は初期化済みなので、そのままヒープに領域を確保します。フィールドは既定値 ({fields}) で、参照がスタックに積まれます。コンストラクタはまだ呼ばれていません。

<!-- ldc -->
## `ldc #{index}` — 文字列定数を積む

<!-- ldc-first -->

String エントリは記号参照ではなく**静的定数**で、解決は要りません (§5.1)。同じ内容の String が intern 済みならそれを、なければ新しく作って intern したものを使います (いつ作るかは実装しだいです)。その参照をスタックに積みます。

<!-- ldc-again -->

同じ内容の String がすでに intern されているので、その参照を積みます。

<!-- invokespecial-local -->
## `invokespecial` — `{name}` を呼ぶ

`invokespecial` は、解決したメソッドをそのまま呼びます。スタックから {args} を取り出し、新しいフレームのローカル変数 0 番 (this) と 1 番に入れます。

<!-- invokespecial-jdk -->
## `invokespecial` — `{method}` を呼ぶ

スタックから this ({receiver}) を取り出し、`{target}` を呼んで戻ってきます (中身は省略)。

<!-- putfield -->
## `putfield` — フィールドに書き込む

スタックから値 {value} とオブジェクト参照を取り出し、{target} の `{name}` に入れます。

<!-- getfield-cached -->
## `getfield #{index}` — 解決済みの結果を使う

`#{index}` は、`<init>` の `putfield` がすでに解決しています。命令が違っても、指す番号が同じなら解決は 1 回で済みます。{target} の `{name}` の値 {value} を積みます。

<!-- getfield -->
## `getfield #{index}` — フィールドを読む

`{name}` の値 {value} を積みます。

<!-- getstatic-cached -->
## `getstatic #{index}` — 解決済みの結果を使う

`#{index}` は解決済み。クラスを探す手順も、フィールドを探す手順もなく、記録された参照から `{owner}.{name}` の値を読んで積みます。

<!-- getstatic -->
## `getstatic #{index}` — static フィールドを読む

フィールドを宣言している `{className}` は JVM の起動時に初期化済みなので、ここで初期化は起きません (§5.5)。`{name}` の値 PrintStream@{id} をスタックに積みます。

<!-- invokevirtual-cached -->
## `invokevirtual #{index}` — 解決済みの結果で呼ぶ

<!-- invokevirtual -->
## `invokevirtual #{index}` — `{name}` を呼ぶ

<!-- invokevirtual-local-cached -->

`#{index}` は解決済み。レシーバ {receiver} のクラスから `{name}` を選び、新しいフレームで実行を始めます。

<!-- invokevirtual-local -->

`invokevirtual` は、レシーバの実際のクラスから呼ぶメソッドを選びます (§5.4.6)。{receiver} のクラスは {className} なので、`{className}.{name}` が選ばれます。新しいフレームのローカル変数 0 番に this を入れて、実行を始めます。

<!-- invokevirtual-jdk -->

レシーバ {receiver} のクラスから `{method}` を選んで呼びます (中身は省略)。コンソールに {printed} が出力されます。

<!-- return -->
## `{mnemonic}` — {method} から戻る

<!-- return-caller -->

`{method}` が終わりました。フレームを捨てて、`{caller}` の続き (pc {pc}) に戻ります。

<!-- return-value -->

戻り値 {value} は呼び出し元のスタックに積まれます。

<!-- return-main -->

`main` が終わり、フレームがなくなりました。

<!-- skip -->
## `{mnemonic}`

この命令の動きは省略します。

<!-- indy-cached -->
## `invokedynamic #{index}` — 結びついた CallSite を使う

この命令はすでに CallSite@{site} に結びついています。ブートストラップメソッドは**呼ばれません**。同じ CallSite のメソッドハンドルを {arg} で呼び、新しい String "{result}" を積みます。

<!-- indy-step-attr -->
## bootstrap_method_attr_index → BootstrapMethods[{bootstrapIndex}]

<!-- indy-step-handle -->
## メソッドハンドル `#{ref}` を解決

<!-- indy-step-type -->
## 記述子から MethodType を作り、静的引数を用意

<!-- indy-step-call -->
## ブートストラップメソッドを呼ぶ

<!-- indy-step-bind -->
## 返ってきた CallSite をこの命令に結びつける

<!-- indy -->
## `invokedynamic #{index}` — 呼び出し地点を解決する

`#{index}` は InvokeDynamic。bootstrap_method_attr_index は BootstrapMethods 属性の {bootstrapIndex} 番を指します。名前と型は `{name}` `{descriptor}` です。これから、**この命令のための**呼び出し先を作ります。

<!-- indy-handle -->
## `#{ref}` MethodHandle を解決する

`#{ref}` は {kind} のメソッドハンドルで、`#{methodref}` の Methodref を指します。その class_index `#{classIndex}` から `{className}` を解決し (ロードされていなければ、ここでロードします)、`{name}` を探します。

<!-- indy-type -->
## MethodType と静的引数を用意する

`#{index}` の記述子から MethodType `{type}` を作ります。静的引数 `#{recipeIndex}` は文字列定数なので、レシピ `"{recipe}"` の String を用意します。`\u0001` の位置に、実行時の引数が入ります。

<!-- indy-call -->
## ブートストラップメソッドを呼ぶ

`{factory}.{method}` に、Lookup、名前 `"{name}"`、MethodType、レシピを渡して呼びます。REF_invokeStatic のハンドルを初めて呼ぶので、`{factory}` がまだ初期化されていなければ、ここで初期化されます (§5.5)。戻り値は **CallSite** です。

<!-- indy-bind -->
## CallSite を結びつけて呼ぶ

CallSite@{site} は **この invokedynamic 命令 ({at}) だけ**に結びつきます。同じ `#{index}` を指す別の命令があっても、そちらは未解決のままです (§5.4.3)。CallSite のメソッドハンドルを {arg} で呼び、"{result}" をスタックに積みます。

<!-- done -->
## 実行が終わりました

記号参照の解決は **{resolutions} 回**、解決済みの結果の再利用は **{hits} 回**でした。2 回目の `System.out.println(g.greet())` では、どの命令も解決の手順を踏まず、記録された結果をそのまま使っています。
