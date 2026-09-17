public class Greeter {
    private static final String GREETING = "Hello, ";

    private final String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return GREETING + name + "!";
    }

    public static void main(String[] args) {
        Greeter g = new Greeter("JVM");
        System.out.println(g.greet());
        System.out.println(g.greet());
    }
}
