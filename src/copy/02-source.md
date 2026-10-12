# 02 ソースの解説文

<!-- 各項目は key を書いたコメント行で始まる。続く「## 」の行が見出し用のラベル、その下が本文。本文は 1 段落 1 行の文。{name} はコードが埋める値。 -->

<!-- class -->
## クラス宣言

クラス名は Class と Utf8 の組で表します。extends を書かなくても、親クラスとして `java/lang/Object` が入ります。

<!-- constant -->
## 定数フィールド

値がコンパイル時に決まる `static final` の定数です。値 "Hello, " は **ConstantValue 属性**に入り、クラスを初期化するときにフィールドへ入ります。

<!-- field -->
## フィールド宣言

フィールドの名前と型を、2 つの Utf8 で表します。型は `Ljava/lang/String;` という**記述子**の形です。

<!-- ctor -->
## コンストラクタ

コンストラクタの名前は `<init>` です。書いていない `super()` の呼び出しも javac が入れるので、Object のコンストラクタへの Methodref ができます。

<!-- assign -->
## フィールドへの代入

代入は `putfield` 命令になり、Fieldref を 1 つ使います。その中身の Class や名前は、クラス宣言とフィールド宣言で生まれたエントリの再利用です。

<!-- greet -->
## メソッド宣言

メソッドの名前と記述子。記述子 `()Ljava/lang/String;` は「引数なしで String を返す」という意味です。

<!-- concat -->
## 文字列の連結

Java 9 以降、文字列の `+` は **invokedynamic** になります (JEP 280)。`GREETING` は定数なので、javac は値 "Hello, " をその場に埋め込み、`"Hello, \u0001!"` という 1 つのレシピにまとめます。バイトコードは GREETING を読みません。`\u0001` の位置に name の値が入ります。

<!-- main -->
## main メソッド

記述子 `([Ljava/lang/String;)V` の `[` は配列を表します。

<!-- new -->
## オブジェクトの生成

`new` で領域を確保し、`invokespecial` でコンストラクタを呼びます。文字列 "JVM" は String と Utf8 の 2 つ。Class エントリはクラス宣言のものをそのまま使います。

<!-- out1 -->
## static フィールドの読み出し

`System.out` は static フィールドなので `getstatic`。Fieldref、Class、NameAndType と、3 つの Utf8 が必要です。

<!-- println1 -->
## インスタンスメソッドの呼び出し

記述子 `(Ljava/lang/String;)V` は、コンストラクタの記述子とまったく同じ文字列です。だから**同じ Utf8 を共有**します。

<!-- greet1 -->
## 自分のクラスのメソッド呼び出し

変数 g の読み出しは `aload_1` で、定数プールは使いません。呼び出しの `invokevirtual` が Methodref を 1 つ使います。

<!-- out2 -->
## 2 回目の System.out

16 行目とまったく同じ参照です。命令は増えますが、**定数プールのエントリは 1 つも増えません**。

<!-- println2 -->
## 2 回目の println

命令 `invokevirtual` は 2 つ目ですが、指している番号は 16 行目と同じです。

<!-- greet2 -->
## 2 回目の greet()

同じ Methodref を指すだけなので、新しいエントリはありません。javac は同じ内容のエントリを 1 つにまとめるので、ソース上で 2 回以上読んでも 1 つのエントリが再利用されます。

<!-- hidden -->
## ソースに書いていないもの

属性の名前も Utf8 です。`Code` や `LineNumberTable` はすべてのメソッドで同じエントリを共有します。SourceFile 属性はファイル名を残します。

<!-- hint -->

エントリにカーソルを合わせると中身を表示します。選ぶと 03 で開きます。

<!-- none -->

ありません。
