# Re-adds Object#tainted?/taint/untaint as no-ops so jekyll 3.9 (github-pages,
# liquid 4.0.3) can render on Ruby 3.2+, where these methods were removed.
# Ruby kept them as no-ops through 3.1, matching GitHub Pages' production Ruby.
# Preload via RUBYOPT (see bin/serve, bin/build). Guarded: no-op on Ruby <= 3.1.
unless Object.method_defined?(:tainted?)
  class Object
    def tainted? = false

    def taint = self

    def untaint = self
  end
end
