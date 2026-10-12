# 05 LinkageError の解説文

<!-- `## key: ラベル` で項目が始まり、続く行が本文。ラベルは見出し用の短い句、本文は 1 段落 1 行の文。{name} はコードが埋める値。 -->

## versions: コンパイル時と実行時で Bar のバージョンが違う

`foo/Foo` は `{owner}` の **1.0** に対してコンパイルされました。実行時のクラスパスに入っているのは **2.0** です。1.0 にあった `{method}()` は、2.0 では名前が変わっています。実行時に javac は関与しません。JVM が読むのは、この 2 つの class ファイルです。

## run-old: 1.0 で実行すると正常に終わる

クラスパスに 1.0 を置いて実行すると、`Foo.foo()` は `bar.Bar#buz` と出力して正常に終わります。

## run-new: 2.0 に差し替えて実行する

依存の解決でバージョンが入れ替わり、クラスパスの `bar/Bar` が 2.0 になりました。`Foo.class` は再コンパイルしていません。`Main.main` から `Foo.foo()` が呼ばれます。

## new: `new #{classRef}` — Class エントリは解決できる

`#{classRef}` は Class エントリで、名前は `{owner}` です。クラスパスから 2.0 の `{owner}` が見つかるので、解決は成功します。ここで確認されるのは**クラスの存在だけ**で、メソッドの有無はまだ確認されません。

## ctor: `invokespecial #{ctorRef}` — コンストラクタの Methodref も解決できる

`{owner}.<init>:()V` は 2.0 にもあります。解決できるので、インスタンスが作られます。

## call: `invokevirtual #{callRef}` — {method}() の Methodref を解決する

`#{callRef}` は `{ref}` です。class_index `#{classRef}` は解決済みなので、NameAndType `#{natRef}` から名前 `{method}` と記述子 `()V` を取り出します。次に `{owner}` とその親クラスからメソッドを探します。

## chain-class: class_index `#{classRef}` は解決済み → `{owner}`

## chain-nat: name_and_type_index `#{natRef}` → `{method}` `()V`

## chain-lookup: `{owner}` とその親クラスから探す

## chain-missing: `{owner}` とその親クラスから探す → 見つからない

## chain-throw: `NoSuchMethodError` を投げる

## error: {method}() が見つからず NoSuchMethodError

2.0 の `{owner}` には `{method}()` がありません。親クラス `java/lang/Object` にもないので、メソッドの探索は失敗します。JVM は `NoSuchMethodError` を投げます。これは `IncompatibleClassChangeError` のサブクラスで、さらにその親が **LinkageError** です。

## again: 同じ命令を再実行しても同じエラーになる

一度解決に失敗した記号参照は、その後の解決も同じエラーになります。探索はやり直されません。エラーが投げられるのは、その参照を**使う命令を実行したとき**です。そのため、実行されないコードパスにある参照は、いつまでも検出されません。

## detect: 実行せずに検出する方法

`Foo.class` の定数プールには `{ref}` という**名前と記述子**が残っています。クラスパスにある class ファイルを読んで突き合わせれば、実行せずに JVM と同じ検査ができます。

## note: 実行前に検出する

定数プールにあるのは名前と記述子だけなので、実行しなくても、クラスパス上の class ファイルと突き合わせれば同じ検査ができます。ライブラリの新旧を比べて、壊れる参照だけを報告するツールもあります。[Uika](https://github.com/exoego/uika) は、PR の時点で `NoSuchMethodError` などを検出します。
