(function () {
  "use strict";

  console.log("[HelpOn] app.js carregado - build cadastro debug 2026-05");

  /**
   * Supabase (produção / mobile):
   * - Authentication → URL Configuration: Site URL e Redirect URLs devem usar a URL pública do app,
   *   nunca http://127.0.0.1 ou localhost. Links no e-mail abrem no celular; 127.0.0.1 é o próprio
   *   aparelho → "Site unreachable" / ERR_CONNECTION_FAILED.
   * - Authentication → Providers → Email: OTP / validade do link ≥ 3600 s reduz expiração por
   *   scanners de e-mail (Gmail, etc.).
   */

  function getAuthEmailRedirectTo() {
    if (typeof window !== "undefined" && window.location && window.location.origin) {
      var path = window.location.pathname || "/";
      path = path.replace(/\/index\.html$/i, "/");
      if (path.charAt(path.length - 1) !== "/") {
        path += "/";
      }
      return window.location.origin + path + "#!/auth/confirm";
    }
    return "/#!/auth/confirm";
  }

  angular
    .module("helpOnApp", ["ngRoute", "ngSanitize", "ngAnimate"])
    .config(configureRoutes)
    .config(configureHttp)
    .run(authRunGuard)
    .run(authHashHandlerRun)
    .factory("SupabaseService", SupabaseService)
    .factory("AuthHashHandler", AuthHashHandler)
    .service("AuthService", AuthService)
    .service("ProfileService", ProfileService)
    .service("TicketService", TicketService)
    .service("NotificationService", NotificationService)
    .service("QueueService", QueueService)
    .service("CommentService", CommentService)
    .service("AutomationService", AutomationService)
    .service("KPIService", KPIService)
    .controller("MainController", MainController)
    .directive("uppercaseOnly", uppercaseOnlyDirective)
    .directive("restrictPattern", restrictPatternDirective)
    .directive("profileDirective", profileDirective)
    .directive("slaBadge", slaBadgeDirective);

  configureRoutes.$inject = ["$routeProvider"];
  function configureRoutes($routeProvider) {
    $routeProvider
      .when("/dashboard", { templateUrl: "dashboard.html" })
      .when("/tickets", { templateUrl: "tickets.html" })
      .when("/complete-profile", { templateUrl: "complete-profile.html" })
      .when("/auth/check-inbox", { templateUrl: "auth-check-inbox.html" })
      .when("/auth/confirm", { templateUrl: "auth-confirm.html" })
      .when("/auth/callback", { templateUrl: "auth-confirm.html" })
      .when("/auth/error-link", { templateUrl: "error-link.html" })
      .otherwise({ redirectTo: "/dashboard" });
  }

  configureHttp.$inject = ["$httpProvider"];
  function configureHttp($httpProvider) {
    $httpProvider.interceptors.push(["$q", "$injector", function ($q, $injector) {
      return {
        request: function (config) {
          var AuthService = $injector.get("AuthService");
          if (!AuthService.hasValidJwt()) {
            var $location = $injector.get("$location");
            var path = $location.path() || "";
            var isPublicAuth = path.indexOf("/auth/") === 0;
            if (path !== "/" && !isPublicAuth) {
              $location.path("/");
            }
          }
          return config;
        },
        responseError: function (rejection) {
          return $q.reject(rejection);
        }
      };
    }]);
  }

  AuthHashHandler.$inject = ["$window", "$q", "SupabaseService", "$location"];
  function AuthHashHandler($window, $q, SupabaseService, $location) {
    return {
      bootstrap: function () {
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(SupabaseService.client.auth.getSession());
        }).then(function (res) {
          return res && res.data ? res.data.session : null;
        }).catch(function () {
          return null;
        });
      },
      cleanUrlAfterEmailConfirm: function () {
        try {
          var path = $location.path() || "";
          if (path !== "/auth/confirm" && path !== "/auth/callback") {
            return;
          }
          var qs = $window.location.search || "";
          var url =
            $window.location.origin +
            $window.location.pathname +
            qs +
            "#!" +
            path;
          $window.history.replaceState({}, $window.document.title, url);
        } catch (e) {
          /* ignore */
        }
      }
    };
  }

  authHashHandlerRun.$inject = ["$rootScope", "$location", "$window", "$timeout", "SupabaseService", "AuthHashHandler"];
  function authHashHandlerRun($rootScope, $location, $window, $timeout, SupabaseService, AuthHashHandler) {
    AuthHashHandler.bootstrap();

    $rootScope.$on("$locationChangeStart", function (event, newUrl) {
      var urlToCheck = newUrl || $window.location.href;
      var hasAccessToken = urlToCheck.indexOf("access_token=") !== -1;
      var hasError = urlToCheck.indexOf("error=") !== -1;

      if (hasAccessToken || hasError) {
        var isOtpExpired = urlToCheck.indexOf("otp_expired") !== -1 || urlToCheck.indexOf("expired") !== -1;
        
        if (isOtpExpired || (hasError && !hasAccessToken)) {
          event.preventDefault();
          $timeout(function() {
            $location.url("/auth/error-link");
          });
          return;
        }

        if (hasAccessToken) {
          event.preventDefault();
          var hashPart = urlToCheck.split('#')[1] || "";
          var cleanHash = hashPart.replace(/^!\/?/, '');
          
          var params = new window.URLSearchParams(cleanHash.split('?')[0]);
          if (!params.has("access_token")) {
             params = new window.URLSearchParams((urlToCheck.split('?')[1] || "").split('#')[0]);
          }
          
          var accessToken = params.get("access_token");
          var refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken && SupabaseService.client) {
            SupabaseService.client.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            }).then(function() {
              $timeout(function() {
                $location.url("/auth/confirm");
              });
            });
          }
        }
      }
    });
  }

  authRunGuard.$inject = ["$rootScope", "$location", "AuthService", "ProfileService"];
  function authRunGuard($rootScope, $location, AuthService, ProfileService) {
    $rootScope.$on("$routeChangeStart", function (event, next) {
      var target = (next && next.$$route && next.$$route.originalPath) || "";
      var publicPath = target === "" || target === "/auth/check-inbox" || target === "/auth/confirm" || target === "/auth/callback" || target === "/auth/error-link";
      if (publicPath) {
        return;
      }
      if (!AuthService.hasValidJwt()) {
        event.preventDefault();
        $location.path("/");
        return;
      }
      if (target !== "/complete-profile" && !ProfileService.isProfileComplete()) {
        event.preventDefault();
        $location.path("/complete-profile");
      }
    });
  }

  SupabaseService.$inject = ["$q"];
  function SupabaseService($q) {
    var SUPABASE_URL = "https://xuevhgvbrscyxwvklbke.supabase.co";
    var SUPABASE_ANON_KEY = "sb_publishable_pXGDbChVanUln742FRe5iA_a1fxM9Jj";
    var configError = null;

    function isValidSupabaseUrl(value) {
      return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(value || ""));
    }

    function isValidPublicKey(value) {
      var key = String(value || "");
      return key.length > 20 && key.indexOf("YOUR_SUPABASE") === -1;
    }

    function getSafeError(error) {
      return {
        name: error && error.name,
        message: error && error.message,
        status: error && error.status,
        code: error && error.code
      };
    }

    function testSupabaseConnectivity() {
      return fetch(SUPABASE_URL + "/auth/v1/settings", {
        headers: {
          apikey: SUPABASE_ANON_KEY
        }
      })
        .then(function (r) {
          console.log("[HelpOn][Supabase connectivity]", r.status, r.statusText);
          return r.text();
        })
        .then(function (text) {
          console.log("[HelpOn][Supabase connectivity body]", text.slice(0, 300));
          return text;
        })
        .catch(function (error) {
          console.error("[HelpOn][Supabase connectivity failed]", error);
          throw error;
        });
    }

    function assertConfigured() {
      if (configError) {
        return $q.reject(configError);
      }
      if (!isValidSupabaseUrl(SUPABASE_URL) || !isValidPublicKey(SUPABASE_ANON_KEY)) {
        return $q.reject(new Error("Configuracao do Supabase invalida: verifique SUPABASE_URL e SUPABASE_ANON_KEY."));
      }
      return $q.resolve();
    }

    function createClient() {
      if (!isValidSupabaseUrl(SUPABASE_URL) || !isValidPublicKey(SUPABASE_ANON_KEY)) {
        throw new Error("Configuracao do Supabase invalida: verifique SUPABASE_URL e SUPABASE_ANON_KEY.");
      }
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("Supabase JS nao foi carregado. Verifique o script CDN no index.html.");
      }
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }

    var client = null;
    try {
      client = createClient();
    } catch (error) {
      configError = error;
      console.error("[HelpOn][Supabase] Client init error:", getSafeError(error));
    }

    window.HelpOnDiagnostics = window.HelpOnDiagnostics || {};
    window.HelpOnDiagnostics.testSupabaseConnectivity = testSupabaseConnectivity;

    return {
      client: client,
      getSafeError: getSafeError,
      testSupabaseConnectivity: testSupabaseConnectivity,
      assertConfigured: assertConfigured
    };
  }

  function localizeErrorMessage(error) {
    var raw = (error && (error.message || error.error_description || error.msg)) || "Falha desconhecida.";
    var message = String(raw).toLowerCase();
    var status = Number(error && error.status);
    var code = String((error && (error.code || error.error_code)) || "").toLowerCase();
    var name = String((error && error.name) || "").toLowerCase();

    if (message.indexOf("supabase js nao foi carregado") !== -1) {
      return "Supabase JS nao foi carregado. Verifique o script CDN no index.html.";
    }
    if (message.indexOf("configuracao do supabase invalida") !== -1) {
      return "Configuracao do Supabase invalida: verifique SUPABASE_URL e SUPABASE_ANON_KEY.";
    }
    if (
      name === "typeerror" ||
      message.indexOf("failed to fetch") !== -1 ||
      message.indexOf("networkerror") !== -1 ||
      message.indexOf("load failed") !== -1 ||
      message.indexOf("network request failed") !== -1 ||
      message.indexOf("cors") !== -1
    ) {
      return "Nao foi possivel conectar ao Supabase. Verifique conexao, CORS, bloqueadores ou disponibilidade do projeto.";
    }
    if (
      code.indexOf("invalid_api_key") !== -1 ||
      message.indexOf("invalid api key") !== -1 ||
      message.indexOf("api key") !== -1 ||
      message.indexOf("project not found") !== -1 ||
      message.indexOf("supabase_url") !== -1 ||
      message.indexOf("supabase_anon_key") !== -1
    ) {
      return "Configuracao do Supabase invalida. Verifique URL e chave anonima do projeto.";
    }
    if (
      code.indexOf("validation_failed") !== -1 && message.indexOf("redirect") !== -1 ||
      message.indexOf("redirect") !== -1 ||
      (message.indexOf("not allowed") !== -1 && message.indexOf("url") !== -1) ||
      message.indexOf("site url") !== -1
    ) {
      return "Configuracao de redirecionamento do cadastro invalida. Verifique as URLs no Supabase.";
    }
    if (
      code.indexOf("signup_disabled") !== -1 ||
      (message.indexOf("signup") !== -1 && message.indexOf("disabled") !== -1) ||
      message.indexOf("signups not allowed") !== -1 ||
      message.indexOf("provider is not enabled") !== -1
    ) {
      return "Cadastro por e-mail desativado no Supabase.";
    }
    if (
      status === 429 ||
      code.indexOf("rate_limit") !== -1 ||
      message.indexOf("rate limit") !== -1 ||
      message.indexOf("too many") !== -1 ||
      message.indexOf("over_email_send_rate_limit") !== -1
    ) {
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    }
    if (
      status >= 500 && message.indexOf("database") !== -1 ||
      message.indexOf("database error saving new user") !== -1 ||
      message.indexOf("error saving new user") !== -1
    ) {
      return "Erro ao criar perfil do usuario no Supabase. Verifique triggers, tabela profiles e migration SQL.";
    }
    if (message.indexOf("row-level security policy") !== -1) {
      return "Nao foi possivel salvar ou acessar o perfil. Verifique as policies RLS no Supabase.";
    }
    if (message.indexOf("invalid login credentials") !== -1) {
      return "E-mail ou senha inválidos.";
    }
    if (message.indexOf("email not confirmed") !== -1) {
      return "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.";
    }
    if (message.indexOf("otp_expired") !== -1 || message.indexOf("invalid or has expired") !== -1) {
      return "O link de e-mail expirou ou já foi utilizado.";
    }
    if (
      message.indexOf("user already registered") !== -1 ||
      message.indexOf("already registered") !== -1 ||
      message.indexOf("already exists") !== -1
    ) {
      return "Este e-mail já está cadastrado.";
    }
    if (
      message.indexOf("password should be at least") !== -1 ||
      message.indexOf("weak password") !== -1 ||
      (message.indexOf("password") !== -1 && message.indexOf("characters") !== -1)
    ) {
      return "A senha deve ter pelo menos 6 caracteres.";
    }
    if (message.indexOf("network") !== -1 || message.indexOf("fetch") !== -1 || message.indexOf("cors") !== -1) {
      return "Nao foi possivel conectar ao Supabase. Verifique conexao, CORS, bloqueadores ou disponibilidade do projeto.";
    }
    if (message.indexOf("jwt") !== -1) {
      return "Sua sessão expirou. Faça login novamente.";
    }
    return "Nao foi possivel concluir a operacao. Veja o console para detalhes tecnicos.";
  }

  AuthService.$inject = ["$q", "SupabaseService", "$sanitize"];
  function AuthService($q, SupabaseService, $sanitize) {
    var client = SupabaseService.client;
    var LOCK_KEY = "helpon_auth_lock";
    var ATTEMPTS_KEY = "helpon_auth_attempts";
    var MAX_ATTEMPTS = 3;
    var LOCK_MS = 5 * 60 * 1000;

    function sanitizeText(input) {
      return $sanitize(String(input || "")).trim();
    }

    function normalizeDateInput(input) {
      if (!input) {
        return "";
      }
      if (input instanceof Date && !isNaN(input.getTime())) {
        return input.toISOString().slice(0, 10);
      }
      return sanitizeText(input).slice(0, 10);
    }

    function buildProfileMetadata(profileData) {
      var source = profileData || {};
      var legalFirstName = sanitizeText(source.legal_first_name);
      var lastName = sanitizeText(source.last_name);
      return {
        legal_first_name: legalFirstName,
        last_name: lastName,
        full_name: sanitizeText((legalFirstName + " " + lastName).trim()),
        birth_date: normalizeDateInput(source.birth_date),
        document_number: sanitizeText(source.document_number),
        document_country: sanitizeText(source.document_country),
        nationality: sanitizeText(source.nationality),
        gender: sanitizeText(source.gender),
        phone_number: sanitizeText(source.phone_number),
        country: sanitizeText(source.country),
        state: sanitizeText(source.state),
        city: sanitizeText(source.city),
        role: "user"
      };
    }

    function getLockUntil() {
      return Number(window.localStorage.getItem(LOCK_KEY) || 0);
    }

    function getAttempts() {
      return Number(window.localStorage.getItem(ATTEMPTS_KEY) || 0);
    }

    function isLocked() {
      return Date.now() < getLockUntil();
    }

    function registerFailure() {
      var attempts = getAttempts() + 1;
      window.localStorage.setItem(ATTEMPTS_KEY, String(attempts));
      if (attempts >= MAX_ATTEMPTS) {
        window.localStorage.setItem(LOCK_KEY, String(Date.now() + LOCK_MS));
        window.localStorage.setItem(ATTEMPTS_KEY, "0");
      }
    }

    function clearFailures() {
      window.localStorage.setItem(ATTEMPTS_KEY, "0");
      window.localStorage.setItem(LOCK_KEY, "0");
    }

    function hasValidJwt() {
      try {
        if (!client || !client.supabaseUrl) { return false; }
        var raw = window.localStorage.getItem("sb-" + client.supabaseUrl.split("//")[1].split(".")[0] + "-auth-token");
        if (!raw) { return false; }
        var parsed = JSON.parse(raw);
        var token = parsed && parsed.access_token;
        if (!token) { return false; }
        var payload = JSON.parse(window.atob(token.split(".")[1]));
        return payload.exp * 1000 > Date.now();
      } catch (error) {
        return false;
      }
    }

    return {
      getSession: function () {
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.auth.getSession()).then(function (res) { return res.data.session; });
        });
      },
      signIn: function (email, password) {
        if (isLocked()) {
          return $q.reject(new Error("Bloqueio temporario por tentativas excessivas."));
        }
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.auth.signInWithPassword({
            email: sanitizeText(email),
            password: sanitizeText(password)
          })).then(function (res) {
            if (res.error) {
              registerFailure();
            } else {
              clearFailures();
            }
            return res;
          });
        });
      },
      signUp: function (email, password, profileData) {
        return SupabaseService.assertConfigured().then(function () {
          var options = {
            emailRedirectTo: getAuthEmailRedirectTo()
          };
          if (profileData) {
            options.data = buildProfileMetadata(profileData);
          }
          console.log("[HelpOn][signUp] Calling Supabase Auth signup", {
            redirectTo: getAuthEmailRedirectTo(),
            hasClient: !!client,
            hasSupabase: !!window.supabase
          });
          return $q.when(client.auth.signUp({
            email: sanitizeText(email),
            password: sanitizeText(password),
            options: options
          })).then(function (res) {
            if (res && res.error) {
              console.error("[HelpOn][signUp] Auth response error:", SupabaseService.getSafeError(res.error));
              throw res.error;
            }
            return res;
          }).catch(function (error) {
            console.error("[HelpOn][signUp] Supabase error:", SupabaseService.getSafeError(error));
            throw error;
          });
        });
      },
      resendSignup: function (email) {
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.auth.resend({
            type: "signup",
            email: sanitizeText(email),
            options: {
              emailRedirectTo: getAuthEmailRedirectTo()
            }
          }));
        });
      },
      signOut: function () {
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.auth.signOut()).then(function (res) {
            clearFailures();
            return res;
          });
        });
      },
      hasValidJwt: hasValidJwt,
      isLocked: isLocked,
      getRemainingLockSeconds: function () {
        return Math.max(0, Math.ceil((getLockUntil() - Date.now()) / 1000));
      },
      sanitizeText: sanitizeText
    };
  }

  ProfileService.$inject = ["$q", "SupabaseService", "AuthService"];
  function ProfileService($q, SupabaseService, AuthService) {
    var client = SupabaseService.client;
    var PROFILE_KEY = "helpon_profile_complete";
    var PENDING_PROFILE_PREFIX = "helpon_pending_profile_";

    function normalizeDateInput(input) {
      if (!input) {
        return "";
      }
      if (input instanceof Date && !isNaN(input.getTime())) {
        return input.toISOString().slice(0, 10);
      }
      return AuthService.sanitizeText(input).slice(0, 10);
    }

    function isFutureDate(value) {
      var date = new Date(value);
      if (isNaN(date.getTime())) {
        return false;
      }
      date.setHours(0, 0, 0, 0);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      return date.getTime() > today.getTime();
    }

    function normalizeRole(value) {
      var role = AuthService.sanitizeText(value || "user");
      return role === "admin" || role === "agent" || role === "user" ? role : "user";
    }

    function mapProfile(payload, userId) {
      payload = payload || {};
      var legalFirstName = AuthService.sanitizeText(payload.legal_first_name);
      var lastName = AuthService.sanitizeText(payload.last_name);
      var fullName = AuthService.sanitizeText((legalFirstName + " " + lastName).trim());
      return {
        id: userId,
        legal_first_name: legalFirstName,
        last_name: lastName,
        full_name: fullName,
        birth_date: normalizeDateInput(payload.birth_date),
        document_number: AuthService.sanitizeText(payload.document_number),
        document_country: AuthService.sanitizeText(payload.document_country),
        nationality: AuthService.sanitizeText(payload.nationality),
        gender: AuthService.sanitizeText(payload.gender),
        phone_number: AuthService.sanitizeText(payload.phone_number),
        country: AuthService.sanitizeText(payload.country),
        state: AuthService.sanitizeText(payload.state),
        city: AuthService.sanitizeText(payload.city),
        role: normalizeRole(payload.role)
      };
    }

    function isComplete(profile) {
      return Boolean(
        profile &&
        profile.legal_first_name &&
        profile.last_name &&
        profile.birth_date &&
        !isFutureDate(profile.birth_date) &&
        profile.document_number &&
        profile.document_country &&
        profile.nationality &&
        profile.phone_number &&
        profile.country &&
        profile.state &&
        profile.city
      );
    }

    return {
      fetchProfile: function (userId) {
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.from("profiles").select("*").eq("id", userId).maybeSingle()).then(function (res) {
            if (res.error) { throw res.error; }
            window.localStorage.setItem(PROFILE_KEY, String(isComplete(res.data)));
            return res.data;
          });
        });
      },
      upsertProfile: function (payload, userId) {
        var row = mapProfile(payload, userId);
        return SupabaseService.assertConfigured().then(function () {
          return $q.when(client.from("profiles").upsert(row).select("*").single()).then(function (res) {
            if (res.error) { throw res.error; }
            window.localStorage.setItem(PROFILE_KEY, String(isComplete(res.data)));
            return res.data;
          });
        });
      },
      isProfileComplete: function () {
        return window.localStorage.getItem(PROFILE_KEY) === "true";
      },
      storePendingProfile: function (payload, userId) {
        var key = PENDING_PROFILE_PREFIX + userId;
        window.localStorage.setItem(key, JSON.stringify(payload || {}));
      },
      consumePendingProfile: function (userId) {
        var key = PENDING_PROFILE_PREFIX + userId;
        var raw = window.localStorage.getItem(key);
        if (!raw) {
          return null;
        }
        window.localStorage.removeItem(key);
        try {
          return JSON.parse(raw);
        } catch (error) {
          return null;
        }
      }
    };
  }

  TicketService.$inject = ["$q", "SupabaseService"];
  function TicketService($q, SupabaseService) {
    var client = SupabaseService.client;
    var profileNameCache = {};
    var hasTicketsLocationColumn = null;

    var priorityMatrix = {
      Crítico: { Crítica: "Urgente", Alta: "Urgente", Média: "Alta", Baixa: "Alta" },
      Alto: { Crítica: "Urgente", Alta: "Alta", Média: "Alta", Baixa: "Média" },
      Médio: { Crítica: "Alta", Alta: "Média", Média: "Média", Baixa: "Baixa" },
      Baixo: { Crítica: "Média", Alta: "Média", Média: "Baixa", Baixa: "Baixa" }
    };

    var slaByPriority = { Urgente: 60, Alta: 180, Média: 480, Baixa: 1440 };
    var statusFlow = ["Aberto", "Pendente", "Em Andamento", "Em Espera", "Resolvido", "Fechado"];

    function classifyPriority(impact, urgency) {
      return (priorityMatrix[impact] && priorityMatrix[impact][urgency]) || "Média";
    }

    function slaMinutesFor(priority) {
      return slaByPriority[priority] || 480;
    }

    function getSlaDeadline(priority) {
      var minutes = slaMinutesFor(priority);
      return new Date(Date.now() + minutes * 60000).toISOString();
    }

    function isOnHoldStatus(status) {
      return status === "On Hold" || status === "Em Espera";
    }

    function safeMs(value) {
      var n = Number(value);
      return isFinite(n) && n > 0 ? n : 0;
    }

    function getRemainingSLA(ticket, now) {
      if (!ticket || !ticket.sla_deadline) {
        return null;
      }

      var nowDate = now instanceof Date ? now : new Date(now || Date.now());
      var deadlineMs = new Date(ticket.sla_deadline).getTime();
      if (!isFinite(deadlineMs)) {
        return null;
      }

      var adjustedDeadlineMs = deadlineMs + safeMs(ticket.total_paused_ms);
      var paused = isOnHoldStatus(ticket.status) && !!ticket.last_paused_at;
      var remainingMs;

      if (paused) {
        var lastPausedMs = new Date(ticket.last_paused_at).getTime();
        if (isFinite(lastPausedMs)) {
          remainingMs = adjustedDeadlineMs - lastPausedMs;
        } else {
          paused = false;
          remainingMs = adjustedDeadlineMs - nowDate.getTime();
        }
      } else {
        remainingMs = adjustedDeadlineMs - nowDate.getTime();
      }

      var remainingMinutes = Math.round(remainingMs / 60000);
      var absolute = Math.abs(remainingMinutes);
      var hours = Math.floor(absolute / 60);
      var minutes = absolute % 60;

      var label = (remainingMinutes < 0 ? "-" : "") + hours + "h " + minutes + "m";
      if (paused) {
        label = "⏸ " + label;
      }

      var state;
      if (paused) {
        state = "paused";
      } else if (remainingMinutes < 0) {
        state = "breached";
      } else if (remainingMinutes <= 30) {
        state = "critical";
      } else if (remainingMinutes <= 60) {
        state = "warning";
      } else {
        state = "ok";
      }

      return {
        remainingMinutes: remainingMinutes,
        remainingLabel: label,
        slaState: state,
        paused: paused
      };
    }

    function getStats(filteredTickets, now) {
      var tickets = filteredTickets || [];
      var byStatus = {};
      var total = 0;
      var slaOk = 0;
      var slaBreached = 0;

      tickets.forEach(function (t) {
        if (!t) { return; }
        total += 1;

        var status = t.status || "Unknown";
        byStatus[status] = (byStatus[status] || 0) + 1;

        var r = getRemainingSLA(t, now);
        if (!r) { return; }

        if (r.slaState === "breached") {
          slaBreached += 1;
          return;
        }

        // Extra Tip: paused counts as OK (time is stopped)
        slaOk += 1;
      });

      return {
        total: total,
        slaOk: slaOk,
        slaBreached: slaBreached,
        byStatus: byStatus
      };
    }

    function normalizeOptionalUuid(value) {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      if (typeof value === "object" && value !== null && value.id) {
        return value.id;
      }
      return value;
    }

    function rememberProfileName(id, fullName) {
      if (!id || !fullName) {
        return;
      }
      profileNameCache[String(id)] = String(fullName);
    }

    function resolveProfileName(id) {
      if (!id) {
        return null;
      }
      return profileNameCache[String(id)] || null;
    }

    function looksLikeUuid(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    }

    function decorateTicketRow(row) {
      if (!row) {
        return row;
      }
      row.category_name = row.categories ? row.categories.name : "Sem categoria";
      row.queue_name = row.queue ? row.queue.name : "No queue";
      var assigneeUuid = row.assigned_to;
      var embed = row.assignee;
      delete row.assignee;
      delete row.queue;
      row.assigned_to = {
        id: assigneeUuid || null,
        full_name: embed && embed.full_name ? embed.full_name : null
      };
      if (row.assigned_to.id && row.assigned_to.full_name) {
        rememberProfileName(row.assigned_to.id, row.assigned_to.full_name);
      }
      return row;
    }

    function decorateHistoryRow(row) {
      if (!row) {
        return row;
      }
      var oldValue = row.old_value || {};
      var newValue = row.new_value || {};
      var oldLabel = "";
      var newLabel = "";
      var actionLabel = "Changed field";
      var actorName = "System";
      if (row.actor_id) {
        actorName = row.actor && row.actor.full_name ? row.actor.full_name : "User Removed";
      }

      if (row.action === "status_change") {
        actionLabel = "Changed status";
        oldLabel = oldValue.status || "Unknown";
        newLabel = newValue.status || "Unknown";
      } else if (row.action === "assignment_change") {
        actionLabel = "Changed assignment";
        var oldAssigned = oldValue.assigned_to ? String(oldValue.assigned_to) : "";
        var newAssigned = newValue.assigned_to ? String(newValue.assigned_to) : "";
        if (oldAssigned && looksLikeUuid(oldAssigned)) {
          oldLabel = resolveProfileName(oldAssigned) || oldAssigned;
        } else {
          oldLabel = oldAssigned ? oldAssigned : "Unassigned";
        }
        if (newAssigned && looksLikeUuid(newAssigned)) {
          newLabel = resolveProfileName(newAssigned) || newAssigned;
        } else {
          newLabel = newAssigned ? newAssigned : "Unassigned";
        }
      } else if (row.action === "priority_change") {
        actionLabel = "Changed priority";
        oldLabel = oldValue.priority || "Unknown";
        newLabel = newValue.priority || "Unknown";
      }

      row.actor_name = actorName;
      row.action_label = actionLabel;
      row.old_label = oldLabel;
      row.new_label = newLabel;
      row.summary = actorName + " " + actionLabel.toLowerCase() + " from \"" + oldLabel + "\" to \"" + newLabel + "\"";
      return row;
    }

    function fetchCategories() {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(client.from("categories").select("id,name").order("name")).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data || [];
        });
      });
    }

    function fetchTickets() {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("tickets")
            .select("*,categories(name),queue:queues(name),assignee:profiles!assigned_to(full_name)")
            .order("created_at", { ascending: false })
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return (res.data || []).map(decorateTicketRow);
        });
      });
    }

    function fetchHistory(ticketId) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("ticket_history")
            .select("*,actor:profiles(full_name)")
            .eq("ticket_id", ticketId)
            .order("created_at", { ascending: true })
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return (res.data || []).map(decorateHistoryRow);
        });
      });
    }

    function detectTicketsLocationColumn() {
      if (hasTicketsLocationColumn !== null) {
        return $q.when(hasTicketsLocationColumn);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(client.from("tickets").select("location").limit(1)).then(function (res) {
          if (res && res.error) {
            hasTicketsLocationColumn = false;
            return false;
          }
          hasTicketsLocationColumn = true;
          return true;
        }).catch(function () {
          hasTicketsLocationColumn = false;
          return false;
        });
      });
    }

    function createTicket(payload) {
      var priority = classifyPriority(payload.impact, payload.urgency);
      var now = new Date();
      var slaDeadline = new Date(now.getTime() + slaMinutesFor(priority) * 60000).toISOString();
      return detectTicketsLocationColumn().then(function (supportsLocation) {
        return SupabaseService.assertConfigured().then(function () {
          var row = {
            ticket_code: "INC-" + Date.now().toString().slice(-6),
            title: payload.title,
            description: payload.description || "",
            category_id: payload.category_id,
            requester_name: payload.requester_name,
            requester_id: normalizeOptionalUuid(payload.requester_id),
            impact: payload.impact,
            urgency: payload.urgency,
            priority: priority,
            severity: payload.severity,
            status: "Aberto",
            sla_deadline: slaDeadline,
            assigned_to: normalizeOptionalUuid(payload.assigned_to),
            queue_id: normalizeOptionalUuid(payload.queue_id)
          };
          if (supportsLocation) {
            row.location = String(payload.location || "").trim() || null;
          }
          return $q.when(
            client.from("tickets").insert([row]).select("*,categories(name),queue:queues(name),assignee:profiles!assigned_to(full_name)").single()
          ).then(function (res) {
            if (res.error) { throw res.error; }
            return decorateTicketRow(res.data);
          });
        });
      });
    }

    function updateTicket(ticketId, patch) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client.from("tickets").update(patch).eq("id", ticketId).select("*,categories(name),queue:queues(name),assignee:profiles!assigned_to(full_name)").single()
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return decorateTicketRow(res.data);
        });
      });
    }

    function assignTicket(ticketId, userId) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("tickets")
            .update({ assigned_to: normalizeOptionalUuid(userId) })
            .eq("id", ticketId)
            .select("*,categories(name),queue:queues(name),assignee:profiles!assigned_to(full_name)")
            .single()
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return decorateTicketRow(res.data);
        });
      });
    }

    function deleteTicket(ticketId) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(client.from("tickets").delete().eq("id", ticketId)).then(function (res) {
          if (res.error) { throw res.error; }
          return true;
        });
      });
    }

    return {
      statusFlow: statusFlow,
      classifyPriority: classifyPriority,
      getSlaDeadline: getSlaDeadline,
      getRemainingSLA: getRemainingSLA,
      getStats: getStats,
      rememberProfileName: rememberProfileName,
      fetchCategories: fetchCategories,
      fetchTickets: fetchTickets,
      fetchHistory: fetchHistory,
      createTicket: createTicket,
      updateTicket: updateTicket,
      assignTicket: assignTicket,
      deleteTicket: deleteTicket
    };
  }

  QueueService.$inject = ["$q", "SupabaseService"];
  function QueueService($q, SupabaseService) {
    var client = SupabaseService.client;
    function fetchQueues() {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(client.from("queues").select("id,name,description").order("name")).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data || [];
        });
      });
    }
    return {
      fetchQueues: fetchQueues
    };
  }

  NotificationService.$inject = ["$q", "SupabaseService"];
  function NotificationService($q, SupabaseService) {
    var client = SupabaseService.client;

    function search(userId, query, limit) {
      var q = (query || "").trim();
      if (!userId) {
        return $q.when([]);
      }
      if (!q) {
        return fetchLatest(userId, limit || 10);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .or("title.ilike.%" + q + "%,content.ilike.%" + q + "%")
            .order("created_at", { ascending: false })
            .limit(limit || 20)
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data || [];
        });
      });
    }

    function fetchUnread(userId) {
      if (!userId) {
        return $q.when([]);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .eq("is_read", false)
            .order("created_at", { ascending: false })
            .limit(20)
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data || [];
        });
      });
    }

    function fetchLatest(userId, limit) {
      if (!userId) {
        return $q.when([]);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("notifications")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit || 10)
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data || [];
        });
      });
    }

    function markRead(notificationId) {
      if (!notificationId) {
        return $q.when(true);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client.from("notifications").update({ is_read: true }).eq("id", notificationId).select("id").single()
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return true;
        });
      });
    }

    function markAllRead(userId) {
      if (!userId) {
        return $q.when(true);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false)
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return true;
        });
      });
    }

    function clearAll(userId) {
      if (!userId) {
        return $q.when(true);
      }
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client.from("notifications").delete().eq("user_id", userId).select("id")
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return true;
        });
      });
    }

    function notify(userId, title, content, type) {
      if (!userId) {
        return $q.when(null);
      }
      var row = {
        user_id: userId,
        title: String(title || "Notification"),
        content: String(content || ""),
        type: String(type || "info")
      };
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(client.from("notifications").insert([row]).select("*").single()).then(function (res) {
          if (res.error) { throw res.error; }
          return res.data;
        });
      });
    }

    return {
      search: search,
      fetchUnread: fetchUnread,
      fetchLatest: fetchLatest,
      markRead: markRead,
      markAllRead: markAllRead,
      clearAll: clearAll,
      notify: notify
    };
  }

  CommentService.$inject = ["$q", "SupabaseService"];
  function CommentService($q, SupabaseService) {
    var client = SupabaseService.client;

    function decorateCommentRow(row) {
      if (!row) {
        return row;
      }
      var author = row.author || null;
      row.author = {
        id: row.author_id || null,
        full_name: author && author.full_name ? author.full_name : "Unknown user"
      };
      return row;
    }

    function fetchComments(ticketId) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("ticket_comments")
            .select("*,author:profiles(full_name)")
            .eq("ticket_id", ticketId)
            .order("created_at", { ascending: true })
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return (res.data || []).map(decorateCommentRow);
        });
      });
    }

    function addComment(ticketId, authorId, content) {
      return SupabaseService.assertConfigured().then(function () {
        return $q.when(
          client
            .from("ticket_comments")
            .insert([{
              ticket_id: ticketId,
              author_id: authorId,
              content: String(content || "").trim(),
              is_internal: false
            }])
            .select("*,author:profiles(full_name)")
            .single()
        ).then(function (res) {
          if (res.error) { throw res.error; }
          return decorateCommentRow(res.data);
        });
      });
    }

    return {
      fetchComments: fetchComments,
      addComment: addComment
    };
  }

  function AutomationService() {
    var rules = [
      {
        name: "Alta Severidade",
        when: function (ticket) { return ticket.severity === "Alta"; },
        message: "Card marcado com gradiente neon e prioridade monitorada em tempo real."
      },
      {
        name: "Urgente Escalonado",
        when: function (ticket) { return ticket.priority === "Urgente"; },
        message: "Escalonado para resposta imediata com SLA agressivo."
      }
    ];

    return {
      evaluate: function (ticket) {
        return rules.filter(function (rule) { return rule.when(ticket); }).map(function (rule) {
          return { ruleName: rule.name, ticketCode: ticket.ticket_code || ticket.id, message: rule.message };
        });
      }
    };
  }

  function KPIService() {
    function minutesBetween(a, b) {
      return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
    }

    return {
      compute: function (tickets) {
        var resolved = tickets.filter(function (t) { return t.status === "Resolvido" || t.status === "Fechado"; });
        var withinSla = resolved.filter(function (t) {
          if (!t.resolved_at || !t.sla_deadline) { return false; }
          return new Date(t.resolved_at).getTime() <= new Date(t.sla_deadline).getTime();
        }).length;
        var avgMin = resolved.length ? Math.round(resolved.reduce(function (acc, t) {
          return acc + minutesBetween(t.created_at, t.resolved_at || t.updated_at || t.created_at);
        }, 0) / resolved.length) : 0;

        return {
          mttr: (avgMin / 60).toFixed(1),
          slaCompliance: resolved.length ? Math.round((withinSla / resolved.length) * 100) : 0,
          backlog: tickets.filter(function (t) { return t.status !== "Resolvido" && t.status !== "Fechado"; }).length,
          resolvedCount: resolved.length
        };
      },
      complianceBySeverity: function (tickets) {
        var levels = ["Baixa", "Média", "Alta", "Crítica"];
        return levels.map(function (level) {
          var rows = tickets.filter(function (t) { return t.severity === level && (t.status === "Resolvido" || t.status === "Fechado"); });
          var ok = rows.filter(function (t) {
            return t.resolved_at && t.sla_deadline && new Date(t.resolved_at).getTime() <= new Date(t.sla_deadline).getTime();
          }).length;
          var pct = rows.length ? Math.round((ok / rows.length) * 100) : 0;
          return { label: level.charAt(0), value: Math.max(8, Math.round(pct * 1.1)) };
        });
      }
    };
  }

  MainController.$inject = ["$scope", "$location", "$interval", "$timeout", "$q", "$document", "SupabaseService", "AuthService", "AuthHashHandler", "ProfileService", "TicketService", "NotificationService", "QueueService", "CommentService", "AutomationService", "KPIService"];
  function MainController($scope, $location, $interval, $timeout, $q, $document, SupabaseService, AuthService, AuthHashHandler, ProfileService, TicketService, NotificationService, QueueService, CommentService, AutomationService, KPIService) {
    var vm = this;
    vm.isSidebarCollapsed = false;
    vm.currentRoute = "dashboard";
    vm.viewTitle = "Dashboard de Performance";
    vm.now = new Date();
    vm.slaNow = new Date();
    vm.connectionOk = true;
    vm.loadingCreate = false;
    vm.user = null;
    vm.message = "";
    vm.isAuthRoute = false;
    vm.pendingEmail = window.sessionStorage.getItem("helpon_pending_email") || "";
    vm.resendLoading = false;
    vm.emailConfirmState = "processing";
    vm.emailConfirmErrorMessage = "";
    vm.confirmResendEmail = "";
    vm.isEmailConfirmRoute = false;
    vm._authEmailLandingInFlight = false;
    vm.linkExpiredDetail = "";
    vm.errorLinkEmail = vm.pendingEmail || "";
    vm.auth = { email: "", password: "", loading: false };
    vm.maxBirthDate = new Date().toISOString().slice(0, 10);
    vm.register = {
      email: "",
      password: "",
      legal_first_name: "",
      last_name: "",
      birth_date: "",
      document_number: "",
      document_country: "",
      nationality: "",
      gender: "",
      phone_number: "",
      country: "",
      state: "",
      city: "",
      role: "user"
    };
    vm.profile = null;
    vm.profileComplete = false;
    vm.authLocked = false;
    vm.authLockRemaining = 0;
    vm.severityLevels = ["Baixa", "Média", "Alta", "Crítica"];
    vm.newTicketPriority = null;
    vm.impactOptions = [
      { value: "Baixo", label: "Baixo - Afeta apenas este usuário" },
      { value: "Médio", label: "Médio - Afeta um departamento ou processo" },
      { value: "Alto", label: "Alto - Afeta múltiplos departamentos" },
      { value: "Crítico", label: "Crítico - Paralisação geral" }
    ];
    vm.urgencyOptions = [
      { value: "Baixa", label: "Baixa - Pode aguardar até 5 dias" },
      { value: "Média", label: "Média - Necessário em até 24h" },
      { value: "Alta", label: "Alta - Necessário em até 4h" },
      { value: "Crítica", label: "Crítica - Imediato" }
    ];

    $scope.$watchGroup(["vm.newTicket.impact", "vm.newTicket.urgency"], function (newVals) {
      if (newVals[0] && newVals[1]) {
        vm.newTicketPriority = TicketService.classifyPriority(newVals[0], newVals[1]);
      } else {
        vm.newTicketPriority = null;
      }
    });

    function computeFlightOnPriority(issueCategory, flightDate) {
      var base = { impact: "Médio", urgency: "Média" };
      switch (issueCategory) {
        case "Alteração/Cancelamento de Voo":
          base = { impact: "Crítico", urgency: "Crítica" };
          break;
        case "Bagagem":
        case "Check-in/Embarque":
          base = { impact: "Alto", urgency: "Alta" };
          break;
        case "Assistência Especial":
        case "Outro":
          base = { impact: "Médio", urgency: "Média" };
          break;
        case "Reembolsos e Compensação":
        case "Achados e Perdidos":
          base = { impact: "Baixo", urgency: "Baixa" };
          break;
      }
      if (flightDate && issueCategory !== "Reembolsos e Compensação" && issueCategory !== "Achados e Perdidos") {
        var now = Date.now();
        var flightMs = new Date(flightDate).getTime();
        if (isFinite(flightMs)) {
          var hoursUntil = (flightMs - now) / (1000 * 60 * 60);
          if (hoursUntil > 0 && hoursUntil < 2) {
            base.urgency = "Crítica";
            if (base.impact === "Baixo") { base.impact = "Médio"; }
          } else if (hoursUntil >= 2 && hoursUntil <= 6) {
            if (base.urgency === "Baixa" || base.urgency === "Média") {
              base.urgency = "Alta";
            }
          }
        }
      }
      return base;
    }

    vm.recalcPriority = function () {
      var cat = vm.newTicket.issueCategory;
      var date = vm.newTicket.flightDate;
      if (cat) {
        var computed = computeFlightOnPriority(cat, date);
        vm.newTicket.impact = computed.impact;
        vm.newTicket.urgency = computed.urgency;
      } else {
        vm.newTicket.impact = "";
        vm.newTicket.urgency = "";
        vm.newTicketPriority = null;
      }
    };


    $scope.$watchGroup(["vm.newTicket.issueCategory", "vm.newTicket.flightDate"], function (newVals) {
      vm.recalcPriority();
    });
    vm.statuses = ["Aberto", "Pendente", "Em Andamento", "Em Espera", "Resolvido", "Fechado"];
    var ROLE_PERMISSIONS = {
      user: {
        canAssign: false,
        canAdvanceStatus: false,
        canDelete: false,
        canSeeAllTickets: false,
        visibleStatuses: ["Aberto", "Em Andamento", "Resolvido", "Fechado"]
      },
      agent: {
        canAssign: true,
        canAdvanceStatus: true,
        canDelete: false,
        canSeeAllTickets: true,
        visibleStatuses: ["Aberto", "Pendente", "Em Andamento", "Em Espera", "Resolvido", "Fechado"]
      },
      admin: {
        canAssign: true,
        canAdvanceStatus: true,
        canDelete: true,
        canSeeAllTickets: true,
        visibleStatuses: ["Aberto", "Pendente", "Em Andamento", "Em Espera", "Resolvido", "Fechado"]
      }
    };
    vm.categories = [];
    vm.queues = [];
    vm.selectedQueue = "";
    vm.tickets = [];
    vm.automationLog = [];
    vm.kpis = { mttr: "0.0", slaCompliance: 0, backlog: 0, resolvedCount: 0 };
    vm.slaSeries = [];
    vm.stats = { total: 0, slaOk: 0, slaBreached: 0, byStatus: {} };
    vm.notifications = [];
    vm.unreadNotifications = 0;
    vm.notificationsOpen = false;
    vm.isNewNotification = false;
    vm.toasts = [];
    vm.newTicket = defaultFormState();
    resetNewTicketForm();
    vm.activeTicketId = null;
    vm.comments = [];
    vm.commentDraft = "";
    vm.commentsLoading = false;
    vm.commentSending = false;
    vm.lastCommentId = null;
    vm.activeTab = "comments";
    vm.history = [];
    vm.historyLoading = false;
    vm.permissions = angular.copy(ROLE_PERMISSIONS.user);
    vm.visibleStatuses = vm.permissions.visibleStatuses.slice();

    vm.toggleSidebar = function () { vm.isSidebarCollapsed = !vm.isSidebarCollapsed; };
    vm.priorityClass = function (priority) { return "priority-" + normalize(priority); };
    vm.severityClass = function (severity) { return "severity-" + normalize(severity); };
    vm.commentInitials = commentInitials;
    vm.isAdmin = function () { return currentRole() === "admin"; };
    vm.isAgent = function () { return currentRole() === "agent"; };
    vm.isUser = function () { return currentRole() === "user"; };
    vm.roleBadgeLabel = function () {
      if (vm.isAdmin()) { return "Logged in as Admin"; }
      if (vm.isAgent()) { return "Logged in as Agent"; }
      return "Logged in as User";
    };
    vm.onQueueFilterChange = function () {
      recompute();
    };

    vm.refreshStats = function () {
      vm.stats = TicketService.getStats(scopedTicketsForQueue(), vm.slaNow || vm.now || new Date());
    };

    vm.kanbanBump = false;
    vm.insightsBump = false;

    vm.toggleNotifications = function () {
      vm.notificationsOpen = !vm.notificationsOpen;
      if (vm.notificationsOpen && vm.user && vm.user.id) {
        refreshNotifications();
      }
    };

    vm.markNotificationRead = function (n) {
      if (!n || n.is_read || !n.id) {
        return;
      }
      NotificationService.markRead(n.id).then(function () {
        n.is_read = true;
        refreshUnreadCount();
      }).catch(handleError).finally(safeApply);
    };

    vm.markAllNotificationsRead = function () {
      if (!vm.user || !vm.user.id) {
        return;
      }
      NotificationService.markAllRead(vm.user.id).then(function () {
        vm.notifications.forEach(function (n) { n.is_read = true; });
        refreshUnreadCount();
      }).catch(handleError).finally(safeApply);
    };

    vm.clearAllNotifications = function () {
      if (!vm.user || !vm.user.id) {
        return;
      }
      NotificationService.clearAll(vm.user.id).then(function () {
        vm.notifications = [];
        vm.unreadNotifications = 0;
        pushToast("Notificações", "Caixa de entrada limpa.", "info");
      }).catch(handleError).finally(safeApply);
    };

    vm.signIn = function () {
      if (AuthService.isLocked()) {
        refreshLockStatus();
        vm.message = "Login temporariamente bloqueado por seguranca.";
        return;
      }
      vm.auth.loading = true;
      AuthService.signIn(vm.auth.email, vm.auth.password).then(function (res) {
        if (res.error) { throw res.error; }
        vm.user = res.data.user;
        vm.user.role = "user";
        refreshPermissions();
        vm.message = "Login realizado com sucesso.";
        return loadProfileAndData();
      }).catch(handleError).finally(function () {
        vm.auth.loading = false;
        refreshLockStatus();
        safeApply();
      });
    };

    vm.signUp = function () {
      console.log("[HelpOn][signUp] Submit triggered");
      console.log("[HelpOn][signUp] Register keys:", Object.keys(vm.register || {}));
      var requiredFields = [
        "email",
        "password",
        "legal_first_name",
        "last_name",
        "birth_date",
        "document_number",
        "document_country",
        "nationality",
        "phone_number",
        "country",
        "state",
        "city"
      ];
      var missingFields = requiredFields.filter(function (field) {
        return !String(vm.register[field] || "").trim();
      });
      if (missingFields.length) {
        console.warn("[HelpOn][signUp] Missing fields:", missingFields);
        vm.message = "Preencha todos os campos obrigatórios.";
        return;
      }
      var birthDate = vm.register.birth_date instanceof Date ? vm.register.birth_date : new Date(vm.register.birth_date);
      if (birthDate && !isNaN(birthDate.getTime())) {
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        birthDate.setHours(0, 0, 0, 0);
        if (birthDate.getTime() > today.getTime()) {
          vm.message = "A data de nascimento nao pode ser futura.";
          return;
        }
      }
      vm.auth.loading = true;
      var registerProfile = angular.copy(vm.register);
      delete registerProfile.password;
      AuthService.signUp(vm.register.email, vm.register.password, registerProfile).then(function (res) {
        if (res.error) { throw res.error; }
        var session = res.data && res.data.session;
        var user = res.data.user;
        if (!user || !user.id) {
          vm.message = "Conta criada. Verifique seu e-mail para confirmar o cadastro.";
          return;
        }
        if (!session || !session.user) {
          ProfileService.storePendingProfile(registerProfile, user.id);
          vm.pendingEmail = vm.register.email;
          window.sessionStorage.setItem("helpon_pending_email", vm.pendingEmail);
          vm.message = "";
          $location.path("/auth/check-inbox");
          return;
        }
        return ProfileService.upsertProfile(registerProfile, user.id).then(function () {
          vm.pendingEmail = vm.register.email;
          window.sessionStorage.setItem("helpon_pending_email", vm.pendingEmail);
          vm.message = "Conta criada. Verifique seu e-mail para confirmar o cadastro.";
          $location.path("/auth/check-inbox");
        });
      }).catch(function (error) {
        console.error("[HelpOn][signUp] Flow error:", SupabaseService.getSafeError(error));
        handleError(error);
      }).finally(function () {
        vm.auth.loading = false;
        refreshLockStatus();
        safeApply();
      });
    };

    vm.signOut = function () {
      AuthService.signOut().then(function () {
        vm.user = null;
        vm.profile = null;
        vm.profileComplete = false;
        vm.tickets = [];
        vm.categories = [];
        vm.automationLog = [];
        vm.comments = [];
        vm.history = [];
        vm.activeTicketId = null;
        vm.commentDraft = "";
        vm.lastCommentId = null;
        vm.activeTab = "comments";
        vm.newTicket = defaultFormState();
        resetNewTicketForm();
        vm.notifications = [];
        vm.unreadNotifications = 0;
        vm.notificationsOpen = false;
        vm.toasts = [];
        teardownNotificationsRealtime();
        refreshPermissions();
        vm.message = "Sessão encerrada.";
        $location.path("/");
      }).catch(handleError).finally(safeApply);
    };

    vm.backToEditEmail = function (event) {
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      $location.path("/");
    };

    vm.resendConfirmation = function () {
      if (!vm.pendingEmail) {
        vm.message = "Informe um e-mail valido para reenviar o link.";
        return;
      }
      vm.resendLoading = true;
      AuthService.resendSignup(vm.pendingEmail).then(function (res) {
        if (res.error) { throw res.error; }
        vm.message = "Novo link enviado com sucesso. Confira sua caixa de entrada.";
      }).catch(handleError).finally(function () {
        vm.resendLoading = false;
        safeApply();
      });
    };

    vm.requestNewLink = function () {
      var email = vm.pendingEmail || window.prompt("Digite seu e-mail corporativo:");
      if (!email) {
        return;
      }
      vm.pendingEmail = email;
      window.sessionStorage.setItem("helpon_pending_email", vm.pendingEmail);
      $location.path("/auth/check-inbox");
      vm.resendConfirmation();
    };

    vm.requestActivationLink = function () {
      var email = (vm.errorLinkEmail || vm.pendingEmail || "").trim();
      if (!email) {
        vm.message = "Informe o e-mail corporativo para reenviar o link.";
        return;
      }
      vm.pendingEmail = email;
      window.sessionStorage.setItem("helpon_pending_email", vm.pendingEmail);
      vm.resendLoading = true;
      AuthService.resendSignup(vm.pendingEmail).then(function (res) {
        if (res.error) { throw res.error; }
        vm.message = "Novo link de ativação enviado. Verifique a caixa de entrada e o Spam.";
      }).catch(handleError).finally(function () {
        vm.resendLoading = false;
        safeApply();
      });
    };

    vm.backToLoginFromError = function (event) {
      if (event && event.preventDefault) {
        event.preventDefault();
      }
      vm.linkExpiredDetail = "";
      vm.emailConfirmState = "processing";
      vm.emailConfirmErrorMessage = "";
      vm.message = "";
      $location.path("/");
    };

    vm.goToDashboardAfterEmailConfirm = function () {
      AuthService.getSession().then(function (session) {
        vm.user = session ? session.user : null;
        if (vm.user) {
          vm.user.role = "user";
        }
        refreshPermissions();
        if (!vm.user) {
          vm.message = "Sessao nao encontrada. Faca login com seu e-mail e senha.";
          $location.path("/");
          return;
        }
        return loadProfileAndData();
      }).catch(handleError).finally(safeApply);
    };

    vm.resendConfirmationFromConfirmPage = function () {
      var email = (vm.confirmResendEmail || "").trim();
      if (!email) {
        vm.message = "Informe o e-mail para reenviar a confirmacao.";
        return;
      }
      vm.pendingEmail = email;
      window.sessionStorage.setItem("helpon_pending_email", email);
      vm.resendLoading = true;
      AuthService.resendSignup(email).then(function (res) {
        if (res.error) { throw res.error; }
        vm.message = "Novo e-mail de confirmacao enviado. Verifique a caixa de entrada e o Spam.";
        $location.path("/auth/check-inbox");
      }).catch(handleError).finally(function () {
        vm.resendLoading = false;
        safeApply();
      });
    };

    vm.saveProfile = function (profilePayload) {
      if (!vm.user || !vm.user.id) { return; }
      ProfileService.upsertProfile(profilePayload, vm.user.id).then(function (profile) {
        vm.profile = profile;
        applyRoleFromProfile(profile);
        vm.profileComplete = ProfileService.isProfileComplete();
        vm.message = "Perfil atualizado com sucesso.";
        if (vm.profileComplete) {
          $location.path("/dashboard");
          return loadData();
        }
      }).catch(handleError).finally(safeApply);
    };

    vm.createTicket = function () {
      if (vm.loadingCreate) { return; }
      vm.recalcPriority();
      if (!vm.newTicket.impact || !vm.newTicket.urgency) {
        vm.message = "Selecione a categoria para calcular a prioridade.";
        pushToast("Validação", "Selecione a categoria para calcular a prioridade.", "warning");
        return;
      }
      // Validação simples de obrigatoriedade (apenas toast, sem mensagens fixas na UI)
      if (!vm.newTicket.title || !vm.newTicket.bookingReference || !vm.newTicket.flightNumber || !vm.newTicket.flightDate || !vm.newTicket.originAirport || !vm.newTicket.destinationAirport || !vm.newTicket.passengerName || !vm.newTicket.contactEmail || !vm.newTicket.issueCategory) {
        vm.loadingCreate = false;
        pushToast("Campos obrigatórios", "Preencha todos os campos obrigatórios.", "warning");
        return;
      }
      vm.loadingCreate = true;

      function normalizeKey(value) {
        return String(value || "")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .replace(/[–—]/g, "-")
          .replace(/[áãâà]/g, "a")
          .replace(/[éê]/g, "e")
          .replace(/[í]/g, "i")
          .replace(/[óôõ]/g, "o")
          .replace(/[ú]/g, "u")
          .replace(/ç/g, "c");
      }

      function findCategoryIdByLabel(label) {
        var wanted = normalizeKey(label);
        if (!wanted || !vm.categories || !vm.categories.length) { return null; }
        var match = vm.categories.find(function (c) { return c && normalizeKey(c.name) === wanted; });
        return match ? match.id : null;
      }

      function resolveSafeCategoryId(selectedLabel) {
        var id = findCategoryIdByLabel(selectedLabel);
        if (id) { return id; }
        id = findCategoryIdByLabel("Triage") || findCategoryIdByLabel("General") || findCategoryIdByLabel("Geral");
        if (id) { return id; }
        return (vm.categories && vm.categories.length && vm.categories[0] && vm.categories[0].id) ? vm.categories[0].id : null;
      }

      var categoryLabel = String(vm.newTicket.category || "").trim();
      var categoryId = resolveSafeCategoryId(categoryLabel);

      var priority = TicketService.classifyPriority(vm.newTicket.impact, vm.newTicket.urgency);
      var slaDeadline = TicketService.getSlaDeadline(priority);

      var payload = angular.extend({}, vm.newTicket, {
        requester_id: vm.user && vm.user.id ? vm.user.id : null,
        category_id: categoryId,
        impact: vm.newTicket.impact,
        urgency: vm.newTicket.urgency,
        priority: priority,
        severity: vm.newTicket.severity || vm.severityLevels[1],
        sla_deadline: slaDeadline,
        queue_id: vm.newTicket.queue_id || null,
        location: vm.newTicket.asset_tag || null
      });

      TicketService.createTicket(payload).then(function (ticket) {
        vm.tickets.unshift(ticket);
        vm.automationLog = AutomationService.evaluate(ticket).concat(vm.automationLog);
        vm.newTicket = defaultFormState();
        resetNewTicketForm();
        vm.newTicketPriority = null;
        recompute();
        vm.message = "Chamado criado no PostgreSQL com sucesso.";
        pushToast("Chamado criado", "#" + (ticket.ticket_code || ticket.id) + " salvo com sucesso.", "info");
        if (vm.user && vm.user.id) {
          NotificationService.notify(vm.user.id, "Chamado criado", "#" + (ticket.ticket_code || ticket.id) + " salvo com sucesso.", "info").then(function (n) {
            if (n) { vm.notifications.unshift(n); refreshUnreadCount(); }
          });
        }
      }).catch(function (error) {
        vm.loadingCreate = false;
        safeApply();
        handleError(error);
      }).finally(function () {
        vm.loadingCreate = false;
        safeApply();
      });
    };

    vm.advanceStatus = function (ticket) {
      if (!vm.permissions.canAdvanceStatus) {
        pushToast("Sem permissão", "Você não tem permissão para alterar status.", "warning");
        vm.message = "Você não tem permissão para alterar status.";
        return;
      }
      if (!ticket || !ticket.id || ticket._busy) { return; }
      var flow = TicketService.statusFlow;
      var currentIndex = flow.indexOf(ticket.status);
      if (currentIndex < 0 || currentIndex === flow.length - 1) { return; }
      var nextStatus = flow[currentIndex + 1];
      var patch = { status: nextStatus };
      if (nextStatus === "Resolvido" || nextStatus === "Fechado") {
        patch.resolved_at = new Date().toISOString();
      }
      ticket._busy = true;
      TicketService.updateTicket(ticket.id, patch).then(function (saved) {
        mergeTicket(saved);
        vm.automationLog = AutomationService.evaluate(saved).concat(vm.automationLog);
        recompute();
        pushToast("Status atualizado", "#" + (saved.ticket_code || saved.id) + " → " + nextStatus, "info");
        if (vm.user && vm.user.id) {
          NotificationService.notify(vm.user.id, "Status atualizado", "#" + (saved.ticket_code || saved.id) + " → " + nextStatus, "info").then(function (n) {
            if (n) { vm.notifications.unshift(n); refreshUnreadCount(); }
          });
        }
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.reopenTicket = function (ticket) {
      if (!vm.permissions.canAdvanceStatus) {
        pushToast("Sem permissão", "Você não tem permissão para reabrir chamados.", "warning");
        return;
      }
      if (!ticket || !ticket.id || ticket._busy) { return; }
      ticket._busy = true;
      TicketService.updateTicket(ticket.id, { status: "Em Andamento", resolved_at: null }).then(function (saved) {
        mergeTicket(saved);
        recompute();
        pushToast("Chamado reaberto", "#" + (saved.ticket_code || saved.id) + " retornou para Em Andamento.", "info");
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.editTicket = function (ticket) {
      var newTitle = window.prompt("Novo titulo do chamado:", ticket.title);
      if (!newTitle || newTitle === ticket.title) { return; }
      if (!ticket || !ticket.id || ticket._busy) { return; }
      ticket._busy = true;
      TicketService.updateTicket(ticket.id, { title: newTitle }).then(function (saved) {
        mergeTicket(saved);
        vm.message = "Chamado atualizado.";
        recompute();
        pushToast("Chamado atualizado", "#" + (saved.ticket_code || saved.id) + " renomeado.", "info");
        if (vm.user && vm.user.id) {
          NotificationService.notify(vm.user.id, "Chamado atualizado", "#" + (saved.ticket_code || saved.id) + " renomeado.", "info").then(function (n) {
            if (n) { vm.notifications.unshift(n); refreshUnreadCount(); }
          });
        }
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.deleteTicket = function (ticket) {
      if (!vm.permissions.canDelete) {
        pushToast("Sem permissão", "Somente administradores podem excluir chamados.", "warning");
        vm.message = "Somente administradores podem excluir chamados.";
        return;
      }
      if (!window.confirm("Deseja excluir o chamado " + (ticket.ticket_code || ticket.id) + "?")) { return; }
      if (!ticket || !ticket.id || ticket._busy) { return; }
      ticket._busy = true;
      TicketService.deleteTicket(ticket.id).then(function () {
        vm.tickets = vm.tickets.filter(function (row) { return row.id !== ticket.id; });
        recompute();
        pushToast("Chamado excluído", "#" + (ticket.ticket_code || ticket.id) + " removido.", "warning");
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.claimTicket = function (ticket) {
      if (!vm.permissions.canAssign) {
        pushToast("Sem permissão", "Você não tem permissão para atribuir chamados.", "warning");
        vm.message = "Você não tem permissão para atribuir chamados.";
        return;
      }
      if (!vm.user || !vm.user.id || !ticket || !ticket.id) { return; }
      if (ticket._busy) { return; }
      ticket._busy = true;
      TicketService.assignTicket(ticket.id, vm.user.id).then(function (saved) {
        mergeTicket(saved);
        vm.message = "Chamado atribuído para você.";
        recompute();
        pushToast("Claim", "#" + (saved.ticket_code || saved.id) + " atribuído para você.", "info");
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.releaseTicket = function (ticket) {
      if (!vm.permissions.canAssign) {
        pushToast("Sem permissão", "Você não tem permissão para remover atribuição.", "warning");
        vm.message = "Você não tem permissão para remover atribuição.";
        return;
      }
      if (!vm.user || !vm.user.id || !ticket || !ticket.id) { return; }
      if (!ticket.assigned_to || ticket.assigned_to.id !== vm.user.id) { return; }
      if (ticket._busy) { return; }
      ticket._busy = true;
      TicketService.assignTicket(ticket.id, null).then(function (saved) {
        mergeTicket(saved);
        vm.message = "Atribuição removida.";
        recompute();
        pushToast("Release", "#" + (saved.ticket_code || saved.id) + " liberado.", "info");
      }).catch(handleError).finally(function () {
        ticket._busy = false;
        safeApply();
      });
    };

    vm.toggleTicketDetails = function (ticket) {
      if (!ticket || !ticket.id) { return; }
      if (vm.activeTicketId === ticket.id) {
        vm.activeTicketId = null;
        vm.comments = [];
        vm.history = [];
        vm.commentDraft = "";
        vm.lastCommentId = null;
        return;
      }
      vm.activeTicketId = ticket.id;
      vm.activeTab = "comments";
      vm.comments = [];
      vm.history = [];
      vm.commentDraft = "";
      vm.lastCommentId = null;
      vm.commentsLoading = true;
      vm.historyLoading = true;
      $q.all([
        CommentService.fetchComments(ticket.id),
        TicketService.fetchHistory(ticket.id)
      ]).then(function (all) {
        vm.comments = all[0];
        vm.history = all[1];
        // Add synthetic creation event as first item
        var requesterName = ticket.requester_name || "Usuário";
        var creationEvent = {
          id: "creation_" + ticket.id,
          action: "ticket_created",
          action_label: "abriu o chamado",
          actor_name: requesterName,
          summary: requesterName + " abriu o chamado",
          created_at: ticket.created_at,
          old_label: "",
          new_label: "",
          is_creation_event: true
        };
        vm.history.unshift(creationEvent);
        if (vm.activeTab === "comments") {
          scrollCommentsToBottom(ticket.id);
        }
      }).catch(handleError).finally(function () {
        vm.commentsLoading = false;
        vm.historyLoading = false;
        safeApply();
      });
    };

    vm.sendComment = function (ticket) {
      var content = String(vm.commentDraft || "").trim();
      if (!ticket || !ticket.id || !vm.user || !vm.user.id || !content) { return; }
      if (vm.commentSending) { return; }
      vm.commentSending = true;
      CommentService.addComment(ticket.id, vm.user.id, content).then(function (saved) {
        vm.comments.push(saved);
        vm.lastCommentId = saved.id;
        vm.commentDraft = "";
        scrollCommentsToBottom(ticket.id);
        pushToast("Comentário enviado", "Sua mensagem foi adicionada ao ticket.", "comment");
      }).catch(handleError).finally(function () {
        vm.commentSending = false;
        safeApply();
      });
    };

    function resetNewTicketForm() {
      $timeout(function () {
        if ($scope.newTicketForm) {
          // Sincroniza o viewValue de cada controle com o modelValue atual
          // (evita que valores antigos persistam nos ngModelControllers)
          angular.forEach($scope.newTicketForm, function (control) {
            if (control && typeof control.$setViewValue === "function") {
              control.$viewValue = control.$modelValue;
              control.$render();
              // Re-executa validators para refletir o estado vazio sem marcar dirty
              if (typeof control.$validate === "function") {
                control.$validate();
              }
            }
          });
          $scope.newTicketForm.$setPristine();
          $scope.newTicketForm.$setUntouched();
        }
      }, 0);
    }

    function defaultFormState() {
      return {
        title: "",
        description: "",
        requester_name: (vm.profile && vm.profile.full_name) ? vm.profile.full_name : "",
        category: "",
        asset_tag: "",
        category_id: null,
        // impact/urgency serão calculados dinamicamente pela lógica FlightOn
        impact: "",
        urgency: "",
        severity: vm.severityLevels[1],
        assigned_to: null,
        queue_id: null,
        // Campos específicos da FlightOn
        bookingReference: "",
        flightNumber: "",
        flightDate: null,
        originAirport: "",
        destinationAirport: "",
        passengerName: "",
        contactEmail: "",
        contactPhone: "",
        frequentFlyerNumber: "",
        issueCategory: "",
        otherCategoryDescription: "",
        baggageType: "",
        baggageTagNumber: "",
        assistanceType: "",
        assistanceDetail: "",
        cancellationReason: "",
        preferredAlternative: "",
        refundType: "",
        originalPaymentMethod: "",
        checkInMethod: "",
        boardingPassIssue: "",
        itemDescription: "",
        locationLost: ""
      };
    }

    function normalize(value) {
      return (value || "").toLowerCase().replace(/\s+/g, "-").replace(/[áãâà]/g, "a").replace(/[éê]/g, "e").replace(/[í]/g, "i").replace(/[óôõ]/g, "o").replace(/[ú]/g, "u").replace(/ç/g, "c");
    }

    function groupByStatus() {
      var grouped = {};
      vm.visibleStatuses.forEach(function (status) { grouped[status] = []; });
      var scopedTickets = vm.tickets.filter(function (ticket) {
        if (!vm.selectedQueue) {
          return true;
        }
        return ticket.queue_id === vm.selectedQueue;
      });
      scopedTickets.forEach(function (ticket) {
        if (!grouped[ticket.status]) { return; }
        grouped[ticket.status].push(ticket);
      });
      vm.ticketsByStatus = grouped;
    }

    function mergeTicket(saved) {
      vm.tickets = vm.tickets.map(function (row) { return row.id === saved.id ? saved : row; });
    }

    function commentInitials(comment) {
      var base = (comment && comment.author && comment.author.full_name) || "No Name";
      var parts = String(base).trim().split(/\s+/).filter(Boolean);
      if (!parts.length) { return "NN"; }
      if (parts.length === 1) { return parts[0].charAt(0).toUpperCase(); }
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function scrollCommentsToBottom(ticketId) {
      window.setTimeout(function () {
        var el = window.document.getElementById("comments-thread-" + ticketId);
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }, 30);
    }

    function updateRouteMeta() {
      vm.currentRoute = (($location.path() || "/dashboard").replace("/", "")) || "dashboard";
      var path = $location.path() || "";
      vm.isAuthRoute = /^\/auth\//.test(path);
      vm.isEmailConfirmRoute = path === "/auth/confirm" || path === "/auth/callback";
      if (vm.currentRoute === "tickets") {
        vm.viewTitle = "Gestao de Chamados";
      } else if (vm.currentRoute === "complete-profile") {
        vm.viewTitle = "Completar Perfil";
      } else if (vm.currentRoute === "auth/check-inbox") {
        vm.viewTitle = "Confirme seu E-mail";
      } else if (vm.currentRoute === "auth/confirm" || vm.currentRoute === "auth/callback") {
        vm.viewTitle = "Confirmacao de E-mail";
      } else if (vm.currentRoute === "auth/error-link") {
        vm.viewTitle = "Link invalido";
      } else {
        vm.viewTitle = "Dashboard de Performance";
      }
    }

    function recompute() {
      groupByStatus();
      vm.kpis = KPIService.compute(vm.tickets);
      vm.slaSeries = KPIService.complianceBySeverity(vm.tickets);
      maybeNotifyCriticalTickets();
      vm.refreshStats();
      bumpKanban();
      bumpInsights();
    }

    function bumpKanban() {
      vm.kanbanBump = true;
      $timeout(function () {
        vm.kanbanBump = false;
        safeApply();
      }, 250);
    }

    function bumpInsights() {
      vm.insightsBump = true;
      $timeout(function () {
        vm.insightsBump = false;
        safeApply();
      }, 250);
    }

    function scopedTicketsForQueue() {
      return vm.tickets.filter(function (ticket) {
        if (!vm.selectedQueue) {
          return true;
        }
        return ticket.queue_id === vm.selectedQueue;
      });
    }

    function pushToast(title, content, type) {
      var toast = {
        id: "t_" + Date.now() + "_" + Math.random().toString(16).slice(2),
        title: String(title || ""),
        content: String(content || ""),
        type: String(type || "info")
      };
      vm.toasts.unshift(toast);
      $timeout(function () {
        vm.toasts = vm.toasts.filter(function (t) { return t.id !== toast.id; });
        safeApply();
      }, 1500);
    }

    function refreshUnreadCount() {
      vm.unreadNotifications = (vm.notifications || []).filter(function (n) { return !n.is_read; }).length;
    }

    function refreshNotifications() {
      if (!vm.user || !vm.user.id) {
        vm.notifications = [];
        vm.unreadNotifications = 0;
        return $q.when([]);
      }
      return NotificationService.fetchLatest(vm.user.id, 10).then(function (rows) {
        vm.notifications = rows || [];
        refreshUnreadCount();
        return vm.notifications;
      });
    }

    var notificationsChannel = null;
    function setupNotificationsRealtime() {
      teardownNotificationsRealtime();
      if (!vm.user || !vm.user.id) {
        return;
      }
      var client = SupabaseService.client;
      notificationsChannel = client
        .channel("notifications:" + vm.user.id)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + vm.user.id },
          function (payload) {
            var row = payload && payload.new ? payload.new : null;
            if (!row) { return; }
            vm.notifications.unshift(row);
            vm.notifications = vm.notifications.slice(0, 10);
            refreshUnreadCount();
            pushToast(row.title, row.content, row.type);
            vm.isNewNotification = true;
            $timeout(function () {
              vm.isNewNotification = false;
              safeApply();
            }, 5000);
            safeApply();
          }
        )
        .subscribe();
    }

    function teardownNotificationsRealtime() {
      try {
        if (notificationsChannel) {
          SupabaseService.client.removeChannel(notificationsChannel);
        }
      } catch (e) {
        /* ignore */
      }
      notificationsChannel = null;
    }

    function ownsTicket(ticket) {
      if (!vm.user || !vm.user.id || !ticket) {
        return false;
      }
      if (ticket.assigned_to && ticket.assigned_to.id) {
        return ticket.assigned_to.id === vm.user.id;
      }
      return ticket.requester_id === vm.user.id;
    }

    function maybeNotifyCriticalTickets() {
      if (!vm.user || !vm.user.id) {
        return;
      }
      var now = vm.slaNow || vm.now || new Date();
      (vm.tickets || []).forEach(function (t) {
        if (!t || !t.id || !ownsTicket(t)) {
          return;
        }
        var r = TicketService.getRemainingSLA(t, now);
        if (!r) {
          return;
        }
        var isCritical = r.slaState === "critical";
        if (isCritical && !t._criticalNotified) {
          t._criticalNotified = true;
          NotificationService
            .notify(vm.user.id, "SLA crítico", "#" + (t.ticket_code || t.id) + " está com menos de 30 minutos.", "critical")
            .catch(handleError)
            .finally(safeApply);
        } else if (!isCritical && t._criticalNotified) {
          t._criticalNotified = false;
        }
      });
    }

    function loadData() {
      return $qAll([TicketService.fetchCategories(), TicketService.fetchTickets(), QueueService.fetchQueues()]).then(function (all) {
        vm.categories = all[0];
        vm.tickets = filterTicketsByRole(all[1]);
        vm.queues = all[2];
        vm.newTicket = defaultFormState();
        resetNewTicketForm();
        recompute();
      });
    }

    function loadProfileAndData() {
      return ProfileService.fetchProfile(vm.user.id).then(function (profile) {
        vm.profile = profile;
        if (vm.newTicket && !vm.newTicket.requester_name && vm.profile && vm.profile.full_name) {
          vm.newTicket.requester_name = vm.profile.full_name;
        }
        if (profile && profile.id && profile.full_name) {
          TicketService.rememberProfileName(profile.id, profile.full_name);
        }
        applyRoleFromProfile(profile);
        vm.profileComplete = ProfileService.isProfileComplete();
        if (!vm.profileComplete) {
          var pendingProfile = ProfileService.consumePendingProfile(vm.user.id);
          if (pendingProfile) {
            return ProfileService.upsertProfile(pendingProfile, vm.user.id).then(function (savedProfile) {
              vm.profile = savedProfile;
              applyRoleFromProfile(savedProfile);
              vm.profileComplete = ProfileService.isProfileComplete();
              if (vm.profileComplete) {
                return loadData();
              }
              $location.path("/complete-profile");
            });
          }
        }
        if (!vm.profileComplete) {
          $location.path("/complete-profile");
          return;
        }
        return loadData().then(function () {
          return refreshNotifications();
        }).then(function () {
          setupNotificationsRealtime();
        });
      });
    }

    function bootstrapAuth() {
      AuthService.getSession().then(function (session) {
        vm.user = session ? session.user : null;
        if (vm.user) {
          vm.user.role = "user";
        }
        refreshPermissions();
        if (vm.user) { return loadProfileAndData(); }
        if (!vm.isAuthRoute) {
          vm.message = "Faca login para carregar dados persistentes do Supabase.";
        }
      }).catch(handleError).finally(safeApply);
    }

    function safeDecodeURIComponent(value) {
      try {
        return decodeURIComponent(String(value).replace(/\+/g, " "));
      } catch (e) {
        return String(value || "").replace(/\+/g, " ");
      }
    }

    function peekAuthFragmentQueryString() {
      var pending = "";
      try {
        pending = window.sessionStorage.getItem("helpon_pending_hash") || "";
      } catch (e) {
        pending = "";
      }
      if (pending) {
        return pending;
      }
      var raw = (window.location.hash || "").replace(/^#/, "");
      if (raw.indexOf("!/") === 0) {
        var queryIndex = raw.indexOf("?");
        return queryIndex === -1 ? "" : raw.slice(queryIndex + 1);
      }
      return raw;
    }

    function consumeHelponPendingHash() {
      try {
        window.sessionStorage.removeItem("helpon_pending_hash");
      } catch (e) {
        /* ignore */
      }
    }

    function setAuthEmailFlowError(description) {
      var raw = description ? String(description) : "";
      var detail = raw;
      try {
        if (raw.indexOf("%") !== -1 || raw.indexOf("+") !== -1) {
          detail = safeDecodeURIComponent(raw);
        }
      } catch (e1) {
        detail = raw;
      }
      var path = $location.path();
      if (path === "/auth/confirm" || path === "/auth/callback") {
        vm.emailConfirmState = "error";
        vm.emailConfirmErrorMessage = detail || "Link invalido ou expirado.";
        vm.confirmResendEmail = vm.pendingEmail || vm.confirmResendEmail || "";
        safeApply();
        return;
      }
      vm.linkExpiredDetail = detail;
      vm.errorLinkEmail = vm.pendingEmail || vm.errorLinkEmail || "";
      $location.path("/auth/error-link");
    }

    function handleAuthEmailLanding() {
      if (vm._authEmailLandingInFlight) {
        return;
      }
      vm._authEmailLandingInFlight = true;
      vm.emailConfirmState = "processing";
      vm.emailConfirmErrorMessage = "";
      var fragment = peekAuthFragmentQueryString();
      var hashParams = new window.URLSearchParams(fragment);
      var queryParams = new window.URLSearchParams(window.location.search || "");

      var hashError = hashParams.get("error");
      var queryError = queryParams.get("error");
      var errorDescription = hashParams.get("error_description") || queryParams.get("error_description");
      if (hashError === "access_denied" || queryError === "access_denied" || errorDescription) {
        consumeHelponPendingHash();
        setAuthEmailFlowError(errorDescription || "Email link is invalid or has expired");
        vm._authEmailLandingInFlight = false;
        return;
      }
      if (hashError || queryError) {
        consumeHelponPendingHash();
        setAuthEmailFlowError(errorDescription || hashError || queryError);
        vm._authEmailLandingInFlight = false;
        return;
      }

      var code = queryParams.get("code");
      var tokenHash = queryParams.get("token_hash");
      var type = queryParams.get("type");
      var accessToken = hashParams.get("access_token");
      var refreshToken = hashParams.get("refresh_token");
      var authClient = SupabaseService.client.auth;
      var request;

      if (code) {
        request = authClient.exchangeCodeForSession(code);
      } else if (tokenHash && type) {
        request = authClient.verifyOtp({ token_hash: tokenHash, type: type });
      } else if (accessToken && refreshToken) {
        request = authClient.setSession({ access_token: accessToken, refresh_token: refreshToken });
      } else {
        consumeHelponPendingHash();
        setAuthEmailFlowError("Link invalido ou incompleto.");
        vm._authEmailLandingInFlight = false;
        return;
      }

      request.then(function (res) {
        if (res.error) { throw res.error; }
        consumeHelponPendingHash();
        vm.emailConfirmState = "success";
        vm.message = "";
        AuthHashHandler.cleanUrlAfterEmailConfirm();
      }).catch(function (error) {
        consumeHelponPendingHash();
        setAuthEmailFlowError(localizeErrorMessage(error));
      }).finally(function () {
        vm._authEmailLandingInFlight = false;
        safeApply();
      });
    }

    function maybeHandleAuthEmailLanding() {
      var path = $location.path();
      if (path !== "/auth/confirm" && path !== "/auth/callback") {
        return;
      }
      if (vm.emailConfirmState === "success") {
        return;
      }
      handleAuthEmailLanding();
    }

    function handleError(error) {
      vm.connectionOk = false;
      var msg = localizeErrorMessage(error);
      pushToast("Erro", msg, "critical");
      vm.message = "Erro: " + msg;
    }

    function refreshLockStatus() {
      vm.authLocked = AuthService.isLocked();
      vm.authLockRemaining = AuthService.getRemainingLockSeconds();
    }

    function currentRole() {
      return (vm.user && vm.user.role) || "user";
    }

    function refreshPermissions() {
      var role = currentRole();
      var selected = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.user;
      vm.permissions = angular.copy(selected);
      vm.visibleStatuses = selected.visibleStatuses.slice();
    }

    function applyRoleFromProfile(profile) {
      if (!vm.user) { return; }
      vm.user.role = (profile && profile.role) || "user";
      refreshPermissions();
    }

    function filterTicketsByRole(rows) {
      var list = rows || [];
      if (vm.permissions.canSeeAllTickets || !vm.user || !vm.user.id) {
        return list;
      }
      return list.filter(function (ticket) {
        return ticket.requester_id === vm.user.id;
      });
    }

    function safeApply() {
      if (!$scope.$$phase) { $scope.$applyAsync(); }
    }

    function $qAll(promises) {
      return $q.all(promises);
    }

    updateRouteMeta();
    refreshLockStatus();
    bootstrapAuth();

    $scope.$on("$routeChangeSuccess", function () {
      updateRouteMeta();
      if ($location.path() === "/auth/error-link") {
        vm.errorLinkEmail = vm.pendingEmail || vm.errorLinkEmail || "";
      }
      if ($location.path() === "/auth/confirm" || $location.path() === "/auth/callback") {
        vm.confirmResendEmail = vm.pendingEmail || vm.confirmResendEmail || "";
        maybeHandleAuthEmailLanding();
      }
      safeApply();
    });

    var nowTick = $interval(function () {
      vm.now = new Date();
      updateRouteMeta();
      refreshLockStatus();
    }, 1000);

    var slaTick = $interval(function () {
      vm.slaNow = new Date();
      maybeNotifyCriticalTickets();
      vm.refreshStats();
      safeApply();
    }, 60000);

    $scope.$on("$destroy", function () {
      if (nowTick) { $interval.cancel(nowTick); }
      if (slaTick) { $interval.cancel(slaTick); }
      teardownNotificationsRealtime();
    });
  }

  function uppercaseOnlyDirective() {
    return {
      require: "ngModel",
      link: function(scope, element, attrs, ctrl) {
        function toUpper(val) {
          return (typeof val === "string") ? val.toUpperCase() : val;
        }
        function applyUpper(viewValue) {
          var transformed = toUpper(viewValue);
          if (transformed !== viewValue) {
            ctrl.$setViewValue(transformed, "input");
            ctrl.$render();
          }
          return transformed;
        }
        ctrl.$parsers.push(function(viewValue) {
          return applyUpper(viewValue);
        });
        ctrl.$formatters.push(function(modelValue) {
          return toUpper(modelValue);
        });
      }
    };
  }

  function restrictPatternDirective() {
    return {
      require: "ngModel",
      link: function(scope, element, attrs, ctrl) {
        var rawPattern = attrs.restrictPattern || "";
        var flags = attrs.restrictFlags || "g";
        var maxLen = attrs.maxLength ? parseInt(attrs.maxLength, 10) : null;
        var pattern;
        try {
          pattern = new RegExp(rawPattern, flags);
        } catch (e) {
          pattern = /[^A-Za-z0-9]/g;
        }

        function sanitize(val) {
          if (!val || typeof val !== "string") { return val; }
          var cleaned = val.replace(pattern, "");
          if (maxLen && cleaned.length > maxLen) {
            cleaned = cleaned.substring(0, maxLen);
          }
          return cleaned;
        }

        function applySanitize(viewValue) {
          var cleaned = sanitize(viewValue);
          if (cleaned !== viewValue) {
            ctrl.$setViewValue(cleaned, "input");
            ctrl.$render();
          }
          return cleaned;
        }

        ctrl.$parsers.push(function(viewValue) {
          return applySanitize(viewValue);
        });

        ctrl.$formatters.push(function(modelValue) {
          return sanitize(modelValue);
        });
      }
    };
  }

  function profileDirective() {
    return {
      restrict: "E",
      scope: {
        profile: "=",
        onSave: "&"
      },
      template:
        "<form class='ticket-form register-grid' ng-submit='submit()'>" +
          "<input type='text' ng-model='form.legal_first_name' placeholder='Nome legal' maxlength='80' required>" +
          "<input type='text' ng-model='form.last_name' placeholder='Sobrenome' maxlength='80' required>" +
          "<input type='date' ng-model='form.birth_date' ng-attr-max='{{ maxBirthDate }}' required>" +
          "<input type='text' ng-model='form.document_number' placeholder='Documento' maxlength='30' required>" +
          "<select ng-model='form.document_country' required>" +
            "<option value='' disabled>Pais emissor</option>" +
            "<option value='Brasil'>Brasil</option><option value='Argentina'>Argentina</option><option value='Chile'>Chile</option><option value='Uruguai'>Uruguai</option><option value='Paraguai'>Paraguai</option><option value='Estados Unidos'>Estados Unidos</option><option value='Canada'>Canada</option><option value='Mexico'>Mexico</option><option value='Portugal'>Portugal</option><option value='Espanha'>Espanha</option><option value='Franca'>Franca</option><option value='Alemanha'>Alemanha</option><option value='Italia'>Italia</option><option value='Reino Unido'>Reino Unido</option><option value='Outro'>Outro</option>" +
          "</select>" +
          "<select ng-model='form.nationality' required>" +
            "<option value='' disabled>Nacionalidade</option>" +
            "<option value='Brasileira'>Brasileira</option><option value='Argentina'>Argentina</option><option value='Chilena'>Chilena</option><option value='Uruguaia'>Uruguaia</option><option value='Paraguaia'>Paraguaia</option><option value='Americana'>Americana</option><option value='Canadense'>Canadense</option><option value='Mexicana'>Mexicana</option><option value='Portuguesa'>Portuguesa</option><option value='Espanhola'>Espanhola</option><option value='Francesa'>Francesa</option><option value='Alema'>Alema</option><option value='Italiana'>Italiana</option><option value='Britanica'>Britanica</option><option value='Outra'>Outra</option>" +
          "</select>" +
          "<select ng-model='form.gender'>" +
            "<option value=''>Genero</option><option value='Feminino'>Feminino</option><option value='Masculino'>Masculino</option><option value='Outro'>Outro</option><option value='Prefiro nao informar'>Prefiro nao informar</option>" +
          "</select>" +
          "<input type='tel' ng-model='form.phone_number' placeholder='Celular' maxlength='20' inputmode='tel' required>" +
          "<select ng-model='form.country' required>" +
            "<option value='' disabled>Pais</option>" +
            "<option value='Brasil'>Brasil</option><option value='Argentina'>Argentina</option><option value='Chile'>Chile</option><option value='Uruguai'>Uruguai</option><option value='Paraguai'>Paraguai</option><option value='Estados Unidos'>Estados Unidos</option><option value='Canada'>Canada</option><option value='Mexico'>Mexico</option><option value='Portugal'>Portugal</option><option value='Espanha'>Espanha</option><option value='Franca'>Franca</option><option value='Alemanha'>Alemanha</option><option value='Italia'>Italia</option><option value='Reino Unido'>Reino Unido</option><option value='Outro'>Outro</option>" +
          "</select>" +
          "<input type='text' ng-model='form.state' placeholder='Estado' maxlength='80' required>" +
          "<input type='text' ng-model='form.city' placeholder='Cidade' maxlength='100' required>" +
          "<button type='submit' class='bounce-btn'>Salvar Perfil</button>" +
        "</form>",
      link: function (scope) {
        scope.maxBirthDate = new Date().toISOString().slice(0, 10);
        scope.form = angular.copy(scope.profile || { role: "user" });
        if (scope.form.birth_date && !(scope.form.birth_date instanceof Date)) {
          var parsedBirthDate = new Date(scope.form.birth_date);
          if (!isNaN(parsedBirthDate.getTime())) {
            scope.form.birth_date = parsedBirthDate;
          }
        }
        scope.submit = function () {
          scope.onSave({ profilePayload: scope.form });
        };
      }
    };
  }

  slaBadgeDirective.$inject = ["TicketService"];
  function slaBadgeDirective(TicketService) {
    return {
      restrict: "E",
      scope: { ticket: "=", now: "=" },
      template: "<span class='sla' ng-class='slaState'>{{ remainingLabel }}</span>",
      link: function (scope) {
        scope.$watchGroup(["ticket", "now"], function () {
          if (!scope.ticket || !scope.now) { return; }
          var result = TicketService.getRemainingSLA(scope.ticket, scope.now);
          if (!result) { return; }
          scope.remainingLabel = result.remainingLabel;
          scope.slaState = result.slaState;
        });
      }
    };
  }
})();
