public class Greeter {
    static final long SEED = 0xCAFEBABEL;

    private final String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return "Hello, " + name + "!";
    }

    public static void main(String[] args) {
        Greeter g = new Greeter("JVM");
        System.out.println(g.greet());
        System.out.println(g.greet());
    }
}
