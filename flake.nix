{
  description = "Development environment";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Tools
    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-root.url = "github:srid/flake-root";

    # process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
  };

  outputs = inputs@{ flake-parts, nixpkgs, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "aarch64-darwin" "x86_64-linux" "aarch64-linux" ];

      imports = [
        inputs.flake-root.flakeModule
        # inputs.process-compose-flake.flakeModule
      ];

      perSystem = { self', pkgs, system, lib, config, ... }:
        {
          _module.args.pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          devShells.default = pkgs.mkShell {
            nativeBuildInputs = with pkgs;
              [
                bun
                python3
                hadolint
              ];

            packages = with pkgs; [
              just
            ];

            inputsFrom = [
              config.flake-root.devShell
            ];
          };
        };
    };
}
