import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import math
import plotly.graph_objects as go

# --- Helper Functions ---

def get_live_data(ticker_symbol):
    """
    Fetches live data and option chains for a given ticker symbol.
    """
    try:
        stock = yf.Ticker(ticker_symbol)
        # Fast info is often quicker/more reliable than .info for real-time price
        current_price = stock.fast_info.last_price
        
        # Get next earning date
        next_earnings = "N/A"
        try:
            cal = stock.calendar
            # stock.calendar is usually a dict where 'Earnings Date' is a list of date objects or a single date
            if cal and 'Earnings Date' in cal:
                dates = cal['Earnings Date']
                if dates:
                    # Handle if it's a list or single value
                    date_val = dates[0] if isinstance(dates, list) else dates
                    next_earnings = date_val.strftime('%Y-%m-%d')
        except Exception:
            pass

        # Get expiration dates
        expirations = stock.options
        if not expirations:
            return None, [], None, "No options data found."
            
        return current_price, expirations, next_earnings, None
    except Exception as e:
        return None, [], None, str(e)

def analyze_puts(ticker_symbol, current_price, expirations, capital, desired_roi, max_weeks, next_earnings="N/A"):
    """
    Analyzes PUT options for the Wheel Strategy.
    """
    suggestions = []
    today = datetime.now()
    tickers_analyzed_count = 0 
    
    # We'll limit the number of expiration dates to check to keep it fast
    # Filter expirations based on max_weeks
    valid_expirations = []
    for exp_date_str in expirations:
        try:
            exp_date = datetime.strptime(exp_date_str, '%Y-%m-%d')
            days_to_exp = (exp_date - today).days
            if 0 < days_to_exp <= (max_weeks * 7):
                valid_expirations.append(exp_date_str)
        except:
            continue
            
    stock = yf.Ticker(ticker_symbol)

    for exp_date_str in valid_expirations:
        try:
            # Fetch option chain for specific date
            opt_chain = stock.option_chain(exp_date_str)
            puts = opt_chain.puts
            
            exp_date = datetime.strptime(exp_date_str, '%Y-%m-%d')
            days_to_exp = (exp_date - today).days
            if days_to_exp <= 0: days_to_exp = 1 # avoid div by zero

            # Filter Puts
            # 1. Strike < Current Price (OTM Puts usually preferred for Wheel to acquire at discount)
            # 2. Strike * 100 <= Capital (Cash Secured)
            
            candidate_puts = puts[
                (puts['strike'] < current_price) & 
                (puts['strike'] * 100 <= capital)
            ]
            
            for index, row in candidate_puts.iterrows():
                strike = row['strike']
                last_price = row['lastPrice']
                bid = row['bid']
                ask = row['ask']
                
                # Estimate premium (midpoint or last if bid/ask wide/missing)
                premium = bid if bid > 0 else last_price
                if premium <= 0: continue
                
                # ROI Calculation
                # Strategy: Cash Secured Put. Risk is Strike * 100. Reward is Premium * 100.
                capital_required = strike * 100
                total_premium = premium * 100
                
                # ROI for this specific trade duration
                trade_roi = (total_premium / capital_required) * 100
                
                # Annualized ROI for comparison
                annualized_roi = trade_roi * (365 / days_to_exp)
                
                # Normalize to 'Monthly' ROI roughly for user filter
                monthly_roi_est = trade_roi * (30 / days_to_exp)
                
                if monthly_roi_est >= desired_roi:
                    suggestions.append({
                        "Symbol": ticker_symbol,
                        "Type": "PUT",
                        "Strike": strike,
                        "Expiration": exp_date_str,
                        "Premium": premium,
                        "Cost Basis": strike - premium,
                        "Monthly ROI (%)": round(monthly_roi_est, 2),
                        "Annualized ROI (%)": round(annualized_roi, 2),
                        "Earnings": next_earnings,
                        "Break Even": strike - premium,
                        "Capital Req": capital_required
                    })
                    
        except Exception as e:
            # Skip if chain fetch fails
            continue

    return suggestions

def get_stock_history_with_bollinger(ticker, days=30):
    try:
        stock = yf.Ticker(ticker)
        # Fetch slightly more data to calculate moving averages properly for the start of the 30 day window
        hist = stock.history(period=f"{days+20}d")
        
        if len(hist) == 0:
            return None, "No historical data found"
            
        # Bollinger Bands Calculation (20-day SMA, 2 std dev)
        hist['SMA_20'] = hist['Close'].rolling(window=20).mean()
        hist['Std_Dev'] = hist['Close'].rolling(window=20).std()
        hist['Upper_Band'] = hist['SMA_20'] + (hist['Std_Dev'] * 2)
        hist['Lower_Band'] = hist['SMA_20'] - (hist['Std_Dev'] * 2)
        
        # Slice to requested days
        hist = hist.tail(days)
        return hist, None
    except Exception as e:
        return None, str(e)

# --- Streamlit App ---

st.set_page_config(page_title="Passive Income - Wheel Strategy", layout="wide")

st.title("Passive Income - Wheel Strategy Analyzer")
st.markdown("""
This tool helps you find Cash-Secured Puts to sell for income, based on the **Wheel Strategy**.
It fetches **live data** from Yahoo Finance.
""")

if "selected_ticker" not in st.session_state:
    st.session_state.selected_ticker = None

# --- Sidebar Inputs ---
st.sidebar.header("Strategy Parameters")

capital_input = st.sidebar.number_input("Available Capital ($)", min_value=1000, value=10000, step=500)
roi_target = st.sidebar.slider("Desired Monthly ROI (%)", min_value=0.5, max_value=5.0, value=1.0, step=0.1)
expiration_weeks = st.sidebar.slider("Max Expiration (Weeks)", min_value=1, max_value=12, value=4)

default_tickers = "PLTR, SOFI, AMD, F, T, INTC"
ticker_input = st.sidebar.text_area("Watchlist (comma separated)", value=default_tickers)

# Cleanup tickers
tickers = [t.strip().upper() for t in ticker_input.split(',') if t.strip()]

run_btn = st.sidebar.button("Find Opportunities")

if run_btn:
    if not tickers:
        st.error("Please enter at least one ticker symbol.")
    else:
        all_suggestions = []
        progress_bar = st.progress(0)
        status_text = st.empty()
        
        for i, ticker in enumerate(tickers):
            status_text.text(f"Analyzing {ticker}...")
            
            try:
                current_price, expirations, next_earnings, error = get_live_data(ticker)
                
                if error:
                    st.warning(f"Could not fetch data for {ticker}: {error}")
                    continue
                
                if not expirations:
                     st.warning(f"No options found for {ticker}")
                     continue

                # Run Analysis
                ticker_suggestions = analyze_puts(
                    ticker, 
                    current_price, 
                    expirations, 
                    capital_input, 
                    roi_target, 
                    expiration_weeks,
                    next_earnings
                )
                all_suggestions.extend(ticker_suggestions)
                
            except Exception as e:
                st.error(f"Error processing {ticker}: {e}")
            
            # Update progress
            progress_bar.progress((i + 1) / len(tickers))
        
        status_text.text("Analysis Complete!")
        
        # Display Results
        if all_suggestions:
            df = pd.DataFrame(all_suggestions)
            
            # Formatting
            st.subheader(f"Found {len(df)} Opportunities")
            
            # Sort by highest Monthly ROI by default
            df = df.sort_values(by="Monthly ROI (%)", ascending=False)
            
            # Interactive selection
            st.info("Select a row in the table below to view detailed charts for that stock.")
            
            event = st.dataframe(
                df.style.format({
                    "Strike": "${:.2f}",
                    "Premium": "${:.2f}",
                    "Cost Basis": "${:.2f}",
                    "Break Even": "${:.2f}",
                    "Capital Req": "${:,.0f}",
                    "Monthly ROI (%)": "{:.2f}%",
                    "Annualized ROI (%)": "{:.2f}%"
                }),
                use_container_width=True,
                selection_mode="single-row",
                on_select="rerun"
            )
            
            selected_rows = event.selection.rows
            if selected_rows:
                selected_index = selected_rows[0]
                selected_record = df.iloc[selected_index]
                sel_ticker = selected_record["Symbol"]
                sel_strike = selected_record["Strike"]
                
                st.markdown("---")
                st.subheader(f"Detailed View: {sel_ticker}")
                
                hist_data, err = get_stock_history_with_bollinger(sel_ticker, days=90) # Show 90 days context
                
                if err:
                    st.error(f"Could not load chart: {err}")
                elif hist_data is not None:
                     fig = go.Figure()

                     # Candlestick
                     fig.add_trace(go.Candlestick(x=hist_data.index,
                                    open=hist_data['Open'],
                                    high=hist_data['High'],
                                    low=hist_data['Low'],
                                    close=hist_data['Close'],
                                    name='Price'))
                     
                     # Bollinger Bands
                     fig.add_trace(go.Scatter(x=hist_data.index, y=hist_data['Upper_Band'], 
                                              line=dict(color='gray', width=1), name='Upper Band'))
                     
                     fig.add_trace(go.Scatter(x=hist_data.index, y=hist_data['Lower_Band'], 
                                              line=dict(color='gray', width=1), name='Lower Band',
                                              fill='tonexty', fillcolor='rgba(128,128,128,0.2)'))
                     
                     # Strike Line
                     fig.add_hline(y=sel_strike, line_dash="dash", line_color="red", annotation_text=f"Strike ${sel_strike}")

                     fig.update_layout(
                         title=f"{sel_ticker} Price History & Bollinger Bands (Last 90 Days)",
                         yaxis_title="Stock Price",
                         xaxis_title="Date",
                         xaxis_rangeslider_visible=False,
                         height=600
                     )
                     
                     st.plotly_chart(fig, use_container_width=True)
                     
                     st.info(f"The red dashed line shows your potential entry price (Strike: ${sel_strike}) relative to recent price action.")

            st.markdown("### detailed View")
            st.info("Tip: 'Cost Basis' is your effective entry price if assigned. 'Break Even' is Strike - Premium.")
            
        else:
            st.info("No opportunities found matching your criteria. Try lowering ROI target or increasing capital.")
