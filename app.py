import streamlit as st
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
import math

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

# --- Streamlit App ---

st.set_page_config(page_title="Passive Income - Wheel Strategy", layout="wide")

st.title("Passive Income - Wheel Strategy Analyzer")
st.markdown("""
This tool helps you find Cash-Secured Puts to sell for income, based on the **Wheel Strategy**.
It fetches **live data** from Yahoo Finance.
""")

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
            
            st.dataframe(
                df.style.format({
                    "Strike": "${:.2f}",
                    "Premium": "${:.2f}",
                    "Cost Basis": "${:.2f}",
                    "Break Even": "${:.2f}",
                    "Capital Req": "${:,.0f}",
                    "Monthly ROI (%)": "{:.2f}%",
                    "Annualized ROI (%)": "{:.2f}%"
                }),
                use_container_width=True
            )
            
            st.markdown("### detailed View")
            st.info("Tip: 'Cost Basis' is your effective entry price if assigned. 'Break Even' is Strike - Premium.")
            
        else:
            st.info("No opportunities found matching your criteria. Try lowering ROI target or increasing capital.")
