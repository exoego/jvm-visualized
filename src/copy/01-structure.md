# 01 構造の解説文

<!-- 各項目は key を書いたコメント行で始まる。続く「## 」の行が見出し用のラベル、その下が本文。本文は 1 段落 1 行の文。{name} はコードが埋める値。 -->

<!-- magic -->

class ファイルは必ずこの 4 バイトで始まります。JVM はまずここを見て、読もうとしているのが class ファイルかどうかを確かめます。

<!-- minor-preview -->

65535 は、プレビュー機能を使ったクラスの印です。

<!-- minor -->

マイナーバージョン。Java SE 12 以降は、プレビュー機能を使うクラスだけが 65535 を使い、それ以外は 0 です。

<!-- major -->

{major} は {java} の形式です。JVM は、自分が対応していない新しいバージョンのファイルを `UnsupportedClassVersionError` で拒否します。

<!-- pool-count -->

このファイルの定数プールには、**#1〜#{slots} の {slots} 個**の番号があります。{count} − 1 なのは、番号が 0 ではなく 1 から始まるからです。0 番は使わない決まりで、super_class などで「何も指していない」印に使われます。

<!-- pool-count-long -->

なお Long と Double は 1 つで番号を 2 つ使うので、実際に入っているエントリは {entries} 個です。

<!-- pool -->

ファイルの **{pct}%** を占める表です。エントリの長さはまちまちで、先頭 1 バイトの tag を読むまで、そのエントリが何バイトあるかはわかりません。

<!-- pool-skipped -->

Long と Double は番号を 2 つ使うので、{skipped} は欠番です。

<!-- access-flags -->

{flags}。

<!-- access-super -->

ACC_SUPER は古い互換性のためのフラグで、Java SE 8 以降の JVM は常に立っているものとして扱います。

<!-- this-class -->

このクラス自身。ここにあるのは名前の文字列ではなく、定数プールの**番号**です。`#{index}` は Class エントリで、その name_index `#{nameRef}` の Utf8 に `{name}` が入っています。この項目が定数プールより後ろにあるのは、ここが番号で**指す側**だからです。先に定数プールを読んであるので、番号に出会った時点で中身を引けます。

<!-- super-none -->

0 は親クラスがないことを表します。java/lang/Object と module-info だけがこうなります。

<!-- super -->

親クラス。`#{index}` → `{name}`。

<!-- super-object -->

extends を書かないクラスでは java/lang/Object になります。

<!-- interfaces-none -->

実装しているインターフェースの数。このクラスにはないので、続く interfaces 配列は 0 バイトです。

<!-- interfaces -->

実装しているインターフェースの数。続く {n} 個の u2 が、それぞれ Class エントリを指します。

<!-- fields-count -->

このクラスが宣言しているフィールドの数です。継承したフィールドは含みません。

<!-- methods-count -->

このクラスが宣言しているメソッドの数です。

<!-- methods-ctor -->

コンストラクタも `<init>` という名前のメソッドとして数えます。

<!-- attributes-count -->

クラス全体に付く属性の数です。

<!-- member -->

名前も型も、定数プールの番号で持ちます。name_index `#{nameIndex}` → `{name}`、descriptor_index `#{descriptorIndex}` → `{descriptor}`。

<!-- member-ctor -->

コンストラクタ。

<!-- member-clinit -->

クラスの初期化メソッド。

<!-- member-constant -->

ConstantValue 属性が `#{index}` ({kind} {value}) を指しています。

<!-- member-code -->

Code 属性に {bytes} バイトのバイトコードがあり、max_stack = {maxStack}、max_locals = {maxLocals} です。

<!-- attr-sourcefile -->

コンパイル元のファイル名 `{name}` を残します。スタックトレースの表示などに使われます。

<!-- attr-bootstrap -->

invokedynamic が使う**ブートストラップメソッド**の表です。{count} 件あり、0 番はメソッドハンドル `#{ref}` と静的引数 {args} 個の組です。

<!-- attr-innerclasses -->

入れ子のクラスどうしの関係を記録します。定数プールに入れ子クラス {names} の Class エントリがあるので、この属性が必要になります。

<!-- attr-nest -->

同じネストに属するクラスどうしが private メンバーにアクセスするための情報です (Java 11〜)。

<!-- attr-record -->

record クラスの構成要素を記録します (Java 16〜)。

<!-- attr-permitted -->

sealed クラスを継承できるクラスの一覧です (Java 17〜)。

<!-- attr-signature -->

ジェネリクスの型情報を残します。記述子には現れない型引数がここに入ります。

<!-- attr-unknown -->

{name} 属性。{size} バイトあります。知らない名前の属性は、JVM は読み飛ばします。
