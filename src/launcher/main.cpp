#include "common/command_line.h"

#include "cryptonote_core/cryptonote_core.h"
//#include "cryptonote_config.h"
#include "daemon/command_server.h"
#include "daemon/executor.h" // t_executor
#include "daemonizer/daemonizer.h"
// epee
//#include "string_tools.h"
#include "rpc/core_rpc_server.h"
#include "rpc/rpc_args.h"
#include "daemon/command_line_args.h" // daemon_args
#include "blockchain_db/db_types.h"

#include <stdio.h>
#include "config.hpp"
#include "fs.hpp"
#include <string>
#include <fstream>

namespace po = boost::program_options;
namespace bf = boost::filesystem;

// I think we want the same UI of lokid for a good user experience
// we'll hide as much lokinet detail as possible
// while still allowing advanced users

// maybe have a config file we load for launcher
// and then we make another config to load lokid from

int main(int argc, char const * argv[]) {

  tools::on_startup();

  // behave like lokid
  epee::string_tools::set_module_name_and_folder(argv[0]);

  // Build argument description
  po::options_description all_options("All");
  po::options_description hidden_options("Hidden");
  po::options_description visible_options("Options");
  po::options_description core_settings("Settings");
  po::positional_options_description positional_options;
  {
    // Misc Options

    command_line::add_arg(visible_options, command_line::arg_help);
    command_line::add_arg(visible_options, command_line::arg_version);
    command_line::add_arg(visible_options, daemon_args::arg_os_version);
    command_line::add_arg(visible_options, daemon_args::arg_config_file);

    // Settings
    command_line::add_arg(core_settings, daemon_args::arg_log_file);
    command_line::add_arg(core_settings, daemon_args::arg_log_level);
    command_line::add_arg(core_settings, daemon_args::arg_max_log_file_size);
    command_line::add_arg(core_settings, daemon_args::arg_max_log_files);
    command_line::add_arg(core_settings, daemon_args::arg_max_concurrency);
    command_line::add_arg(core_settings, daemon_args::arg_zmq_rpc_bind_ip);
    command_line::add_arg(core_settings, daemon_args::arg_zmq_rpc_bind_port);

    daemonizer::init_options(hidden_options, visible_options);
    daemonize::t_executor::init_options(core_settings);

    // Hidden options
    command_line::add_arg(hidden_options, daemon_args::arg_command);

    visible_options.add(core_settings);
    all_options.add(visible_options);
    all_options.add(hidden_options);

    // Positional
    positional_options.add(daemon_args::arg_command.name, -1); // -1 for unlimited arguments
  }

  // Do command line parsing
  po::variables_map vm;
  bool ok = command_line::handle_error_helper(visible_options, [&]()
  {
    boost::program_options::store(
      boost::program_options::command_line_parser(argc, argv)
        .options(all_options).positional(positional_options).run()
    , vm
    );

    return true;
  });
  if (!ok) return 1;

  if (command_line::get_arg(vm, command_line::arg_help))
  {
    std::cout << "Loki '" << LOKI_RELEASE_NAME << "' (v" << LOKI_VERSION_FULL << ")" << ENDL << ENDL;
    std::cout << "Usage: " + std::string{argv[0]} + " [options|settings] [daemon_command...]" << std::endl << std::endl;
    std::cout << visible_options << std::endl;
    return 0;
  }

  // Loki Version
  if (command_line::get_arg(vm, command_line::arg_version))
  {
    std::cout << "Loki '" << LOKI_RELEASE_NAME << "' (v" << LOKI_VERSION_FULL << ")" << ENDL;
    return 0;
  }

  // OS
  if (command_line::get_arg(vm, daemon_args::arg_os_version))
  {
    std::cout << "OS: " << tools::get_os_version_string() << ENDL;
    return 0;
  }

    std::string config = command_line::get_arg(vm, daemon_args::arg_config_file);
    boost::filesystem::path config_path(config);
    boost::system::error_code ec;
    if (bf::exists(config_path, ec))
    {
      try
      {
        po::store(po::parse_config_file<char>(config_path.string<std::string>().c_str(), core_settings), vm);
      }
      catch (const std::exception &e)
      {
        // log system isn't initialized yet
        std::cerr << "Error parsing config file: " << e.what() << std::endl;
        throw;
      }
    }
    else if (!command_line::is_arg_defaulted(vm, daemon_args::arg_config_file))
    {
      std::cerr << "Can't find config file " << config << std::endl;
      return 1;
    }

    const bool testnet = command_line::get_arg(vm, cryptonote::arg_testnet_on);
    const bool stagenet = command_line::get_arg(vm, cryptonote::arg_stagenet_on);
    const bool regtest = command_line::get_arg(vm, cryptonote::arg_regtest_on);
    if (testnet + stagenet + regtest > 1)
    {
      std::cerr << "Can't specify more than one of --tesnet and --stagenet and --regtest" << ENDL;
      return 1;
    }

    std::string db_type = command_line::get_arg(vm, cryptonote::arg_db_type);

    // verify that blockchaindb type is valid
    if(!cryptonote::blockchain_valid_db_type(db_type))
    {
      std::cout << "Invalid database type (" << db_type << "), available types are: " <<
        cryptonote::blockchain_db_types(", ") << std::endl;
      return 0;
    }

    // data_dir
    //   default: e.g. ~/.loki/ or ~/.loki/testnet
    //   if data-dir argument given:
    //     absolute path
    //     relative path: relative to cwd

    // Create data dir if it doesn't exist
    boost::filesystem::path data_dir = boost::filesystem::absolute(
        command_line::get_arg(vm, cryptonote::arg_data_dir));

    // FIXME: not sure on windows implementation default, needs further review
    //bf::path relative_path_base = daemonizer::get_relative_path_base(vm);
    bf::path relative_path_base = data_dir;

    po::notify(vm);

    // log_file_path
    //   default: <data_dir>/<CRYPTONOTE_NAME>.log
    //   if log-file argument given:
    //     absolute path
    //     relative path: relative to data_dir
    bf::path log_file_path {data_dir / std::string(CRYPTONOTE_NAME ".log")};
    if (!command_line::is_arg_defaulted(vm, daemon_args::arg_log_file))
      log_file_path = command_line::get_arg(vm, daemon_args::arg_log_file);
    log_file_path = bf::absolute(log_file_path, relative_path_base);
    mlog_configure(log_file_path.string(), true, command_line::get_arg(vm, daemon_args::arg_max_log_file_size), command_line::get_arg(vm, daemon_args::arg_max_log_files));

    // Set log level
    if (!command_line::is_arg_defaulted(vm, daemon_args::arg_log_level))
    {
      mlog_set_log(command_line::get_arg(vm, daemon_args::arg_log_level).c_str());
    }

    // after logs initialized
    tools::create_directories_if_necessary(data_dir.string());

    // If there are positional options, we're running a daemon command
    {
      auto command = command_line::get_arg(vm, daemon_args::arg_command);

      if (command.size())
      {
        const cryptonote::rpc_args::descriptors arg{};
        auto rpc_ip_str = command_line::get_arg(vm, arg.rpc_bind_ip);
        auto rpc_port_str = command_line::get_arg(vm, cryptonote::core_rpc_server::arg_rpc_bind_port);

        uint32_t rpc_ip;
        uint16_t rpc_port;
        if (!epee::string_tools::get_ip_int32_from_string(rpc_ip, rpc_ip_str))
        {
          std::cerr << "Invalid IP: " << rpc_ip_str << std::endl;
          return 1;
        }
        if (!epee::string_tools::get_xtype_from_string(rpc_port, rpc_port_str))
        {
          std::cerr << "Invalid port: " << rpc_port_str << std::endl;
          return 1;
        }

        const char *env_rpc_login = nullptr;
        const bool has_rpc_arg = command_line::has_arg(vm, arg.rpc_login);
        const bool use_rpc_env = !has_rpc_arg && (env_rpc_login = getenv("RPC_LOGIN")) != nullptr && strlen(env_rpc_login) > 0;
        boost::optional<tools::login> login{};
        if (has_rpc_arg || use_rpc_env)
        {
          login = tools::login::parse(
            has_rpc_arg ? command_line::get_arg(vm, arg.rpc_login) : std::string(env_rpc_login), false, [](bool verify) {
#ifdef HAVE_READLINE
        rdln::suspend_readline pause_readline;
#endif
              return tools::password_container::prompt(verify, "Daemon client password");
            }
          );
          if (!login)
          {
            std::cerr << "Failed to obtain password" << std::endl;
            return 1;
          }
        }

        daemonize::t_command_server rpc_commands{rpc_ip, rpc_port, std::move(login)};
        if (rpc_commands.process_command_vec(command))
        {
          return 0;
        }
        else
        {
#ifdef HAVE_READLINE
          rdln::suspend_readline pause_readline;
#endif
          std::cerr << "Unknown command: " << command.front() << std::endl;
          return 1;
        }
      }
    }

    if (!command_line::is_arg_defaulted(vm, daemon_args::arg_max_concurrency))
      tools::set_max_concurrency(command_line::get_arg(vm, daemon_args::arg_max_concurrency));

    // logging is now set up
    MGINFO("Loki '" << LOKI_RELEASE_NAME << "' (v" << LOKI_VERSION_FULL << ")");

    MINFO("Moving from main() into the daemonize now.");

    const command_line::arg_descriptor<bool> arg_detach = {
      "detach"
    , "Run as daemon"
    };
    const command_line::arg_descriptor<std::string> arg_pidfile = {
      "pidfile"
    , "File path to write the daemon's PID to (optional, requires --detach)"
    };
    const command_line::arg_descriptor<bool> arg_non_interactive = {
      "non-interactive"
    , "Run non-interactive"
    };

    //command_line::add_arg(visible_options, arg_detach);
    //command_line::add_arg(visible_options, arg_pidfile);
    //command_line::add_arg(visible_options, arg_non_interactive);

    if (command_line::has_arg(vm, arg_detach))
    {
      tools::success_msg_writer() << "Forking to background...";
      std::string pidfile;
      if (command_line::has_arg(vm, arg_pidfile))
      {
        pidfile = command_line::get_arg(vm, arg_pidfile);
      }
      //posix::fork(pidfile);
      //auto daemon = executor.create_daemon(vm);
      //return daemon.run();
    }
    else if (command_line::has_arg(vm, arg_non_interactive))
    {
      //return executor.run_non_interactive(vm);
    }
    else
    {
      //LOG_PRINT_L0("Loki '" << LOKI_RELEASE_NAME << "' (v" << LOKI_VERSION_FULL);
      //return executor.run_interactive(vm);
    }

#ifdef _WIN32
    fs::path homedir = fs::path(getenv("APPDATA"));
#else
    fs::path homedir = fs::path(getenv("HOME"));
#endif
  fs::path basepath = homedir / fs::path(".lokinet");
  fs::path fpath    = basepath / "lokinet.ini";

  boost::filesystem::path loki_config = daemonizer::get_default_data_dir() / CRYPTONOTE_NAME ".conf";
  printf("loki    config [%s]\n", loki_config.string().c_str());

  // is there a loki config set?

  llarp::Config *lokinet_config = new llarp::Config;
  printf("lokinet config [%s]\n", fpath.string().c_str());
  if (lokinet_config->Load(fpath.string().c_str())) {
    printf("Loaded\n");
    // jsonrpc api
    // read ~/.loki/[testnet]/key
    // FIXME: how do we pass this identity into lokinet
    // is DNS server/lokinet already running
    //   if it's already running, is it configured in a way we need?
    // .loki will not be available for SN
    // .snode will be available
    // ".exit" will be their own type of tun (similar to )
  }
  printf("Hello World\n");
}
